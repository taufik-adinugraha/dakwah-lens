"""SSRF-hardened HTTP wrapper around httpx.

The RSS scraper pulls URLs out of an admin-editable `rss_feeds` table and
trafilatura follows links it finds in the feed payload. Without this guard,
a compromised superadmin (or a typo) could point a feed at
`http://127.0.0.1:5432` or `http://169.254.169.254/...` and we'd cheerfully
fetch internal services / cloud metadata endpoints.

Defence is two-layer:
  1. Syntactic — reject obvious internal hostnames + reserved schemes.
  2. DNS resolve — look up the host and verify EVERY resolved IP is public.

Redirects are followed manually so each hop is revalidated; otherwise an
attacker could host a public 302 → `http://10.0.0.5/`.

There is still a residual DNS-rebinding gap (the host could resolve to a
public IP at validation time and a private IP at httpx fetch time). At
prototype scale on a self-hosted VPS this is acceptable; the Next.js
admin-side filter already blocks the obvious literal-IP attacks at the
storage gate.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx
import structlog

log = structlog.get_logger()

_ALLOWED_SCHEMES = frozenset({"http", "https"})
_BLOCKED_HOSTS = frozenset({"localhost", "0.0.0.0", ""})
_BLOCKED_SUFFIXES = (".local", ".localhost", ".internal")


class UnsafeUrlError(ValueError):
    """Raised when a URL is rejected by the SSRF guard."""


def _is_blocked_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def validate_url(url: str) -> None:
    """Raise UnsafeUrlError if `url` points at internal infrastructure.

    Performs DNS resolution; if ANY resolved address is in a private /
    loopback / link-local / multicast / reserved range, the URL is
    rejected.
    """
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise UnsafeUrlError(f"scheme {parsed.scheme!r} not allowed")
    host = (parsed.hostname or "").lower()
    if host in _BLOCKED_HOSTS:
        raise UnsafeUrlError(f"blocked host {host!r}")
    if any(host.endswith(s) for s in _BLOCKED_SUFFIXES):
        raise UnsafeUrlError(f"blocked host suffix on {host!r}")

    # If the host is itself an IP literal, validate it directly without DNS.
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    if ip is not None:
        if _is_blocked_ip(str(ip)):
            raise UnsafeUrlError(f"blocked IP literal {ip}")
        return

    # Otherwise resolve the hostname and check every address it returns.
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise UnsafeUrlError(f"DNS lookup failed for {host!r}: {exc}") from exc
    if not infos:
        raise UnsafeUrlError(f"no DNS results for {host!r}")
    for info in infos:
        sockaddr = info[4]
        ip_str = sockaddr[0]
        if _is_blocked_ip(ip_str):
            raise UnsafeUrlError(
                f"{host!r} resolves to blocked address {ip_str}"
            )


def safe_get(
    client: httpx.Client,
    url: str,
    *,
    max_redirects: int = 5,
    **kwargs: object,
) -> httpx.Response:
    """`httpx.Client.get` with SSRF validation on the initial URL and on
    every redirect hop.

    `follow_redirects` from kwargs is ignored — we always handle redirects
    manually so we can revalidate. Pass any other httpx kwargs through
    (`timeout`, `headers`, etc.).
    """
    kwargs.pop("follow_redirects", None)
    current = url
    for hop in range(max_redirects + 1):
        validate_url(current)
        resp = client.get(current, follow_redirects=False, **kwargs)  # type: ignore[arg-type]
        if not resp.is_redirect:
            return resp
        location = resp.headers.get("location")
        if not location:
            return resp
        # `urljoin` resolves relative redirects against the previous URL.
        current = urljoin(current, location)
        log.debug("safe_fetch.redirect", hop=hop, to=current)
    raise UnsafeUrlError(f"too many redirects (>{max_redirects}) starting at {url!r}")
