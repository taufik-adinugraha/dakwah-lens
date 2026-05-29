import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { getAssetsByKind } from "@/lib/flyer/images/registry";
import { getQuotaSnapshot } from "@/lib/user-flyer/quota";
import { Link } from "@/i18n/navigation";

import { NewFlyerForm } from "./NewFlyerForm";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/flyers/new">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "UserFlyers" });
  return { title: t("page_title_new") };
}

export default async function NewFlyerPage({
  params,
}: PageProps<"/[locale]/flyers/new">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/flyers/new");
  }

  const t = await getTranslations("UserFlyers");

  const [photos, quota] = await Promise.all([
    // Only photos — ornaments / patterns are decorative and don't make
    // sense as a primary visual for a user-authored flyer.
    getAssetsByKind("photo"),
    getQuotaSnapshot(session.user.id),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-12">
      <header className="mb-6">
        <h1 className="text-balance text-2xl font-bold text-slate-900 sm:text-3xl">
          {t("page_title_new")}
        </h1>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-slate-600">
          {t("subtitle_new")}
        </p>
      </header>

      <NewFlyerForm
        photos={photos.map((p) => ({ id: p.id, src: p.src }))}
        initialQuota={quota}
        labels={{
          stepLayout: t("step_layout"),
          stepImage: t("step_image"),
          stepContent: t("step_content"),
          stepSettings: t("step_settings"),
          layouts: {
            "hero-ayat": {
              title: t("layout_hero_ayat"),
              hint: t("layout_hero_ayat_hint"),
            },
            "hero-headline": {
              title: t("layout_hero_headline"),
              hint: t("layout_hero_headline_hint"),
            },
            "split-image": {
              title: t("layout_split_image"),
              hint: t("layout_split_image_hint"),
            },
            "quote-card": {
              title: t("layout_quote_card"),
              hint: t("layout_quote_card_hint"),
            },
            "dua-hero": {
              title: t("layout_dua_hero"),
              hint: t("layout_dua_hero_hint"),
            },
          },
          imageTabCollection: t("image_tab_collection"),
          imageTabUpload: t("image_tab_upload"),
          imageUploadHint: t("image_upload_hint"),
          imageUploadButton: t("image_upload_button"),
          imageUploadUploading: t("image_upload_uploading"),
          imageUploadSuccess: t("image_upload_success"),
          imageUploadErrorTooLarge: t("image_upload_error_too_large"),
          imageUploadErrorType: t("image_upload_error_type"),
          imageUploadErrorGeneric: t("image_upload_error_generic"),
          contentLabel: t("content_label"),
          contentPlaceholder: t("content_placeholder"),
          contentHelp: t("content_help"),
          includeNewsLabel: t("include_news_label"),
          includeNewsHint: t("include_news_hint"),
          visibilityLabel: t("visibility_label"),
          visibilityPrivate: t("visibility_private"),
          visibilityPrivateHint: t("visibility_private_hint"),
          visibilityPublic: t("visibility_public"),
          visibilityPublicHint: t("visibility_public_hint"),
          submitButton: t("submit_button"),
          submitButtonLoading: t("submit_button_loading"),
          quotaResetTpl: t("quota_reset", { when: "{when}" }),
          quotaChipTpl: t("quota_chip", {
            remaining: "{remaining}",
            limit: "{limit}",
          }),
          quotaExhaustedTitle: t("quota_exhausted_title"),
          quotaExhaustedBody: t("quota_exhausted_body", {
            limit: "{limit}",
            when: "{when}",
          }),
          resultTitle: t("result_title"),
          resultOpenLarge: t("result_open_large"),
          resultDownload: t("result_download"),
          resultViewMine: t("result_view_mine"),
          resultCreateAnother: t("result_create_another"),
          errorGenerationFailed: t("error_generation_failed"),
          errorInvalidInput: t("error_invalid_input"),
          previewSubtitle: t("preview_subtitle"),
          previewConfirm: t("preview_confirm"),
          previewClose: t("preview_close"),
          previewArabicPlaceholder: t("preview_arabic_placeholder"),
        }}
      />

      <p className="mt-8 text-center text-xs text-slate-500">
        <Link href="/flyers/mine" className="underline hover:text-slate-700">
          {t("result_view_mine")}
        </Link>
      </p>
    </div>
  );
}
