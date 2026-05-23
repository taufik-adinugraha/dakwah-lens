"""Bulk seed flyer_assets photo pool — 204 CC0 photos from Unsplash.

Source themes:
  - mosque (25)        - mosque-detail (24)
  - islamic-calligraphy (22) - prayer-objects (17)
  - indonesia-nature (25) - nature-extra (25)
  - sky-light (25)     - writing-hands (24)
  - children-learning (17)

Sourced via /tmp/fetch-flyer-photos.py + /tmp/source-new-themes.py and
hand-reviewed for dakwah appropriateness (58 + 24 inappropriate
candidates flagged + removed across multiple curation passes).

Revision ID: n6r8t0v2x4z6
Revises: m5q7s9u1w3y5
Create Date: 2026-05-23 19:00:00.000000+00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "n6r8t0v2x4z6"
down_revision = "m5q7s9u1w3y5"
branch_labels = None
depends_on = None


# (id, src, aspect, tags) tuples — 204 photos.
SEED_PHOTOS: list[tuple[str, str, str, list[str]]] = [
    ('photo-mosque-D5xvlpBt', '/flyer-assets/photos/uploads/mosque-01-D5xvlpBt.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-8VSMuAKb', '/flyer-assets/photos/uploads/mosque-02-8VSMuAKb.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-VwMGprlC', '/flyer-assets/photos/uploads/mosque-03-VwMGprlC.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-_yhAaEfN', '/flyer-assets/photos/uploads/mosque-04-_yhAaEfN.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-0sFzCjkg', '/flyer-assets/photos/uploads/mosque-05-0sFzCjkg.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-9E7LqxVT', '/flyer-assets/photos/uploads/mosque-06-9E7LqxVT.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-E5J3eTgz', '/flyer-assets/photos/uploads/mosque-07-E5J3eTgz.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-IoO-w7pt', '/flyer-assets/photos/uploads/mosque-08-IoO-w7pt.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-xGuVofvh', '/flyer-assets/photos/uploads/mosque-09-xGuVofvh.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-zqMSk8qK', '/flyer-assets/photos/uploads/mosque-10-zqMSk8qK.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-bb50ODCt', '/flyer-assets/photos/uploads/mosque-11-bb50ODCt.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-JaNAjebv', '/flyer-assets/photos/uploads/mosque-12-JaNAjebv.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-uqIElVtR', '/flyer-assets/photos/uploads/mosque-13-uqIElVtR.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-B-TUPhhc', '/flyer-assets/photos/uploads/mosque-14-B-TUPhhc.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-2XZxRCw0', '/flyer-assets/photos/uploads/mosque-15-2XZxRCw0.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-mrH9CATf', '/flyer-assets/photos/uploads/mosque-16-mrH9CATf.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-Cg-HD932', '/flyer-assets/photos/uploads/mosque-17-Cg-HD932.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-ptFdgDjf', '/flyer-assets/photos/uploads/mosque-18-ptFdgDjf.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-ENMy2SCE', '/flyer-assets/photos/uploads/mosque-19-ENMy2SCE.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-DSkhHXdi', '/flyer-assets/photos/uploads/mosque-20-DSkhHXdi.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-c-ijf9Bp', '/flyer-assets/photos/uploads/mosque-21-c-ijf9Bp.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-aedMupFj', '/flyer-assets/photos/uploads/mosque-22-aedMupFj.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-QmVp8x13', '/flyer-assets/photos/uploads/mosque-23-QmVp8x13.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-2l0YVm_U', '/flyer-assets/photos/uploads/mosque-24-2l0YVm_U.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-mosque-icDgNwst', '/flyer-assets/photos/uploads/mosque-25-icDgNwst.jpg', '1:1', ['masjid', 'ibadah', 'ruang', 'arsitektur']),
    ('photo-children-learning-ocEpT2tK', '/flyer-assets/photos/uploads/children-learning-01-ocEpT2tK.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-xplEn10Z', '/flyer-assets/photos/uploads/children-learning-05-xplEn10Z.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-IxfPGP3b', '/flyer-assets/photos/uploads/children-learning-07-IxfPGP3b.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-dPee-Mbg', '/flyer-assets/photos/uploads/children-learning-08-dPee-Mbg.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-CSC6RWSi', '/flyer-assets/photos/uploads/children-learning-09-CSC6RWSi.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-07p6_tBL', '/flyer-assets/photos/uploads/children-learning-10-07p6_tBL.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-_KPuV9qS', '/flyer-assets/photos/uploads/children-learning-12-_KPuV9qS.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-indonesia-nature-oawplyM6', '/flyer-assets/photos/uploads/indonesia-nature-01-oawplyM6.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-writing-hands-p-LLnsEG', '/flyer-assets/photos/uploads/writing-hands-01-p-LLnsEG.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-EHi9QpjW', '/flyer-assets/photos/uploads/writing-hands-03-EHi9QpjW.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-s9imzeGX', '/flyer-assets/photos/uploads/writing-hands-04-s9imzeGX.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-je6UF6VG', '/flyer-assets/photos/uploads/writing-hands-05-je6UF6VG.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-7dDCTqgp', '/flyer-assets/photos/uploads/writing-hands-06-7dDCTqgp.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-Ua-xaK8b', '/flyer-assets/photos/uploads/writing-hands-08-Ua-xaK8b.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-V3V3WC6W', '/flyer-assets/photos/uploads/writing-hands-09-V3V3WC6W.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-WKEEyDKJ', '/flyer-assets/photos/uploads/writing-hands-10-WKEEyDKJ.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-ZAOYMp1W', '/flyer-assets/photos/uploads/writing-hands-11-ZAOYMp1W.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-iwAjdUsN', '/flyer-assets/photos/uploads/writing-hands-13-iwAjdUsN.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-zUjH3MZ-', '/flyer-assets/photos/uploads/writing-hands-14-zUjH3MZ-.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-CSC6RWSi', '/flyer-assets/photos/uploads/writing-hands-15-CSC6RWSi.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-hNtiP7nV', '/flyer-assets/photos/uploads/writing-hands-16-hNtiP7nV.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-CYUIOyjJ', '/flyer-assets/photos/uploads/writing-hands-17-CYUIOyjJ.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-_KPuV9qS', '/flyer-assets/photos/uploads/writing-hands-20-_KPuV9qS.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-07p6_tBL', '/flyer-assets/photos/uploads/writing-hands-21-07p6_tBL.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-WWUi9NbG', '/flyer-assets/photos/uploads/writing-hands-22-WWUi9NbG.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-v1t81b8R', '/flyer-assets/photos/uploads/writing-hands-24-v1t81b8R.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-QGkdIcuI', '/flyer-assets/photos/uploads/writing-hands-25-QGkdIcuI.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-children-learning-yw9z-otD', '/flyer-assets/photos/uploads/children-learning-16-yw9z-otD.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-JKq3NPV_', '/flyer-assets/photos/uploads/children-learning-17-JKq3NPV_.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-fvxG34jv', '/flyer-assets/photos/uploads/children-learning-19-fvxG34jv.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-indonesia-nature-6NiUh7ZP', '/flyer-assets/photos/uploads/indonesia-nature-02-6NiUh7ZP.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-fSdjQO8r', '/flyer-assets/photos/uploads/indonesia-nature-03-fSdjQO8r.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-kXoEdaZ3', '/flyer-assets/photos/uploads/indonesia-nature-04-kXoEdaZ3.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-wnIeCBJf', '/flyer-assets/photos/uploads/indonesia-nature-05-wnIeCBJf.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-TF1qnG9e', '/flyer-assets/photos/uploads/indonesia-nature-06-TF1qnG9e.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-KW1SLscF', '/flyer-assets/photos/uploads/indonesia-nature-07-KW1SLscF.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-a7n65pmn', '/flyer-assets/photos/uploads/indonesia-nature-08-a7n65pmn.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-PeRt3uMm', '/flyer-assets/photos/uploads/indonesia-nature-09-PeRt3uMm.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-3u51-uLQ', '/flyer-assets/photos/uploads/indonesia-nature-10-3u51-uLQ.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-rARwqh9I', '/flyer-assets/photos/uploads/indonesia-nature-11-rARwqh9I.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-_OQ17__L', '/flyer-assets/photos/uploads/indonesia-nature-12-_OQ17__L.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-ehQNfr7o', '/flyer-assets/photos/uploads/indonesia-nature-13-ehQNfr7o.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-QW3oA2wk', '/flyer-assets/photos/uploads/indonesia-nature-14-QW3oA2wk.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-VsNWi5gN', '/flyer-assets/photos/uploads/indonesia-nature-15-VsNWi5gN.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-i-nbFnz8', '/flyer-assets/photos/uploads/indonesia-nature-16-i-nbFnz8.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-Y678onxF', '/flyer-assets/photos/uploads/indonesia-nature-17-Y678onxF.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-Vr_Ox50Q', '/flyer-assets/photos/uploads/indonesia-nature-18-Vr_Ox50Q.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-dDAzpSUA', '/flyer-assets/photos/uploads/indonesia-nature-19-dDAzpSUA.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-3QFQOxGC', '/flyer-assets/photos/uploads/indonesia-nature-20-3QFQOxGC.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-84JgyHGl', '/flyer-assets/photos/uploads/indonesia-nature-21-84JgyHGl.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-iOm3cItG', '/flyer-assets/photos/uploads/indonesia-nature-22-iOm3cItG.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-r4M3EY2w', '/flyer-assets/photos/uploads/indonesia-nature-23-r4M3EY2w.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-WR8admHN', '/flyer-assets/photos/uploads/indonesia-nature-24-WR8admHN.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-indonesia-nature-4Fzp6z40', '/flyer-assets/photos/uploads/indonesia-nature-25-4Fzp6z40.jpg', '1:1', ['alam', 'sawah', 'indonesia', 'lingkungan']),
    ('photo-children-learning-qPrmz-LI', '/flyer-assets/photos/uploads/children-learning-16-qPrmz-LI.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-87d_Yq1O', '/flyer-assets/photos/uploads/children-learning-18-87d_Yq1O.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-lN7bRp6f', '/flyer-assets/photos/uploads/children-learning-19-lN7bRp6f.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-o9IBX2FX', '/flyer-assets/photos/uploads/children-learning-20-o9IBX2FX.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-B56ziIfY', '/flyer-assets/photos/uploads/children-learning-23-B56ziIfY.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-children-learning-zT08bgl0', '/flyer-assets/photos/uploads/children-learning-25-zT08bgl0.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-writing-hands-OrOY3eY9', '/flyer-assets/photos/uploads/writing-hands-20-OrOY3eY9.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-9TucEPaZ', '/flyer-assets/photos/uploads/writing-hands-23-9TucEPaZ.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-XjzFoGO7', '/flyer-assets/photos/uploads/writing-hands-24-XjzFoGO7.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-writing-hands-FDAIlESG', '/flyer-assets/photos/uploads/writing-hands-25-FDAIlESG.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-children-learning-3CYJkMKK', '/flyer-assets/photos/uploads/children-learning-final-25-3CYJkMKK.jpg', '1:1', ['anak', 'pendidikan', 'ngaji', 'santri']),
    ('photo-writing-hands-bdvycycd', '/flyer-assets/photos/uploads/writing-hands-final-25-bdvycycd.jpg', '1:1', ['menulis', 'jurnal', 'tangan', 'refleksi']),
    ('photo-islamic-calligraphy-4udaet5n', '/flyer-assets/photos/uploads/islamic-calligraphy-01-4udaet5n.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-fk_RMyFK', '/flyer-assets/photos/uploads/islamic-calligraphy-03-fk_RMyFK.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-QCVPnnPV', '/flyer-assets/photos/uploads/islamic-calligraphy-04-QCVPnnPV.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-VQup978U', '/flyer-assets/photos/uploads/islamic-calligraphy-05-VQup978U.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-iZf6K_OC', '/flyer-assets/photos/uploads/islamic-calligraphy-06-iZf6K_OC.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-AB4-AX0O', '/flyer-assets/photos/uploads/islamic-calligraphy-07-AB4-AX0O.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-IJyWpHjI', '/flyer-assets/photos/uploads/islamic-calligraphy-08-IJyWpHjI.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-EYQoVakt', '/flyer-assets/photos/uploads/islamic-calligraphy-09-EYQoVakt.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-dhNqMalG', '/flyer-assets/photos/uploads/islamic-calligraphy-10-dhNqMalG.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-bB0H-7PE', '/flyer-assets/photos/uploads/islamic-calligraphy-12-bB0H-7PE.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-I7Sz2GAd', '/flyer-assets/photos/uploads/islamic-calligraphy-13-I7Sz2GAd.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-UumoXmNz', '/flyer-assets/photos/uploads/islamic-calligraphy-14-UumoXmNz.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-8rDPYpI1', '/flyer-assets/photos/uploads/islamic-calligraphy-15-8rDPYpI1.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-cUEgq9KK', '/flyer-assets/photos/uploads/islamic-calligraphy-16-cUEgq9KK.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-tl3_VlMw', '/flyer-assets/photos/uploads/islamic-calligraphy-17-tl3_VlMw.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-mHZy_vWR', '/flyer-assets/photos/uploads/islamic-calligraphy-18-mHZy_vWR.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-Q4XF0fCw', '/flyer-assets/photos/uploads/islamic-calligraphy-19-Q4XF0fCw.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-LiWrNTFI', '/flyer-assets/photos/uploads/islamic-calligraphy-20-LiWrNTFI.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-LgRpWcrH', '/flyer-assets/photos/uploads/islamic-calligraphy-21-LgRpWcrH.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-XJI2zF_B', '/flyer-assets/photos/uploads/islamic-calligraphy-22-XJI2zF_B.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-LOFvEAtK', '/flyer-assets/photos/uploads/islamic-calligraphy-23-LOFvEAtK.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-islamic-calligraphy-QvTIxJwC', '/flyer-assets/photos/uploads/islamic-calligraphy-25-QvTIxJwC.jpg', '1:1', ['kaligrafi', 'seni', 'arab', 'tulisan']),
    ('photo-prayer-objects-LS8FaYad', '/flyer-assets/photos/uploads/prayer-objects-02-LS8FaYad.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-D734dP1y', '/flyer-assets/photos/uploads/prayer-objects-03-D734dP1y.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-alsfz8lJ', '/flyer-assets/photos/uploads/prayer-objects-04-alsfz8lJ.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-GVbgm6Mz', '/flyer-assets/photos/uploads/prayer-objects-05-GVbgm6Mz.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-eVboxPoX', '/flyer-assets/photos/uploads/prayer-objects-06-eVboxPoX.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-1ZB_bCDo', '/flyer-assets/photos/uploads/prayer-objects-07-1ZB_bCDo.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-tpre9EeG', '/flyer-assets/photos/uploads/prayer-objects-11-tpre9EeG.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-nyOIF_y4', '/flyer-assets/photos/uploads/prayer-objects-13-nyOIF_y4.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-XCXP1rLf', '/flyer-assets/photos/uploads/prayer-objects-16-XCXP1rLf.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-oRskqiH7', '/flyer-assets/photos/uploads/prayer-objects-17-oRskqiH7.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-lW72DTPY', '/flyer-assets/photos/uploads/prayer-objects-18-lW72DTPY.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-iZLRg7JK', '/flyer-assets/photos/uploads/prayer-objects-19-iZLRg7JK.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-Rjevwx7K', '/flyer-assets/photos/uploads/prayer-objects-20-Rjevwx7K.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-j2xcowPA', '/flyer-assets/photos/uploads/prayer-objects-21-j2xcowPA.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-6Q9dODpb', '/flyer-assets/photos/uploads/prayer-objects-22-6Q9dODpb.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-6Jd6k8a6', '/flyer-assets/photos/uploads/prayer-objects-24-6Jd6k8a6.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-prayer-objects-LjJ7NCy-', '/flyer-assets/photos/uploads/prayer-objects-25-LjJ7NCy-.jpg', '1:1', ['ibadah', 'objek', 'shalat', 'ramadan']),
    ('photo-mosque-detail-yyan1TAc', '/flyer-assets/photos/uploads/mosque-detail-02-yyan1TAc.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-V9YdTVV_', '/flyer-assets/photos/uploads/mosque-detail-03-V9YdTVV_.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-6IVU3CHy', '/flyer-assets/photos/uploads/mosque-detail-04-6IVU3CHy.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-1I84jS2J', '/flyer-assets/photos/uploads/mosque-detail-05-1I84jS2J.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-hXIH78Zg', '/flyer-assets/photos/uploads/mosque-detail-06-hXIH78Zg.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-98-QPd4g', '/flyer-assets/photos/uploads/mosque-detail-07-98-QPd4g.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-5cb_klm8', '/flyer-assets/photos/uploads/mosque-detail-08-5cb_klm8.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-1npzBqpz', '/flyer-assets/photos/uploads/mosque-detail-09-1npzBqpz.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-VbjyB2xX', '/flyer-assets/photos/uploads/mosque-detail-10-VbjyB2xX.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-qHaNm-Ys', '/flyer-assets/photos/uploads/mosque-detail-11-qHaNm-Ys.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-lm-9zjN9', '/flyer-assets/photos/uploads/mosque-detail-12-lm-9zjN9.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-j2gxjDvs', '/flyer-assets/photos/uploads/mosque-detail-13-j2gxjDvs.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-04q6Fqz_', '/flyer-assets/photos/uploads/mosque-detail-14-04q6Fqz_.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-_udDObpR', '/flyer-assets/photos/uploads/mosque-detail-15-_udDObpR.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-BkES5vFY', '/flyer-assets/photos/uploads/mosque-detail-16-BkES5vFY.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-JCArTj0K', '/flyer-assets/photos/uploads/mosque-detail-17-JCArTj0K.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-WoXxKjpO', '/flyer-assets/photos/uploads/mosque-detail-18-WoXxKjpO.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-4dpXJh5I', '/flyer-assets/photos/uploads/mosque-detail-19-4dpXJh5I.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-lHHXe1eF', '/flyer-assets/photos/uploads/mosque-detail-20-lHHXe1eF.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-WMabt1k1', '/flyer-assets/photos/uploads/mosque-detail-21-WMabt1k1.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-zKBQMs9q', '/flyer-assets/photos/uploads/mosque-detail-22-zKBQMs9q.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-waL6iN6b', '/flyer-assets/photos/uploads/mosque-detail-23-waL6iN6b.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-EqXIV3PH', '/flyer-assets/photos/uploads/mosque-detail-24-EqXIV3PH.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-mosque-detail-wOuL2Hpl', '/flyer-assets/photos/uploads/mosque-detail-25-wOuL2Hpl.jpg', '1:1', ['masjid', 'arsitektur', 'detail', 'ornamen']),
    ('photo-sky-light-vTZfjwKZ', '/flyer-assets/photos/uploads/sky-light-01-vTZfjwKZ.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-cYDerOoL', '/flyer-assets/photos/uploads/sky-light-02-cYDerOoL.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-lbJfDX0w', '/flyer-assets/photos/uploads/sky-light-03-lbJfDX0w.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-a5rm25OL', '/flyer-assets/photos/uploads/sky-light-04-a5rm25OL.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-kRmotVOb', '/flyer-assets/photos/uploads/sky-light-05-kRmotVOb.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-VQ_3OTiF', '/flyer-assets/photos/uploads/sky-light-06-VQ_3OTiF.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-thJ2oYpR', '/flyer-assets/photos/uploads/sky-light-07-thJ2oYpR.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-gBTT0vwI', '/flyer-assets/photos/uploads/sky-light-08-gBTT0vwI.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-LbTgZ_LW', '/flyer-assets/photos/uploads/sky-light-09-LbTgZ_LW.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-xB9TM4hx', '/flyer-assets/photos/uploads/sky-light-10-xB9TM4hx.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-5F8Mq8k4', '/flyer-assets/photos/uploads/sky-light-11-5F8Mq8k4.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-Apoblp6b', '/flyer-assets/photos/uploads/sky-light-12-Apoblp6b.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-HcRaLsGT', '/flyer-assets/photos/uploads/sky-light-13-HcRaLsGT.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-Pz8PCPWj', '/flyer-assets/photos/uploads/sky-light-14-Pz8PCPWj.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-TsifxiSl', '/flyer-assets/photos/uploads/sky-light-15-TsifxiSl.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-NSu5uWht', '/flyer-assets/photos/uploads/sky-light-16-NSu5uWht.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-bs1hk8R4', '/flyer-assets/photos/uploads/sky-light-17-bs1hk8R4.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-3OS_gppe', '/flyer-assets/photos/uploads/sky-light-18-3OS_gppe.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-1QJ2Dr79', '/flyer-assets/photos/uploads/sky-light-19-1QJ2Dr79.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-ALBNfhBW', '/flyer-assets/photos/uploads/sky-light-20-ALBNfhBW.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-9F7BQYJA', '/flyer-assets/photos/uploads/sky-light-21-9F7BQYJA.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-muKwAMUD', '/flyer-assets/photos/uploads/sky-light-22-muKwAMUD.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-9dEARSIL', '/flyer-assets/photos/uploads/sky-light-23-9dEARSIL.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-lgy2XZ0M', '/flyer-assets/photos/uploads/sky-light-24-lgy2XZ0M.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-sky-light-zIPICE0b', '/flyer-assets/photos/uploads/sky-light-25-zIPICE0b.jpg', '1:1', ['langit', 'cahaya', 'matahari', 'kontemplasi']),
    ('photo-nature-extra-jHDH1dmH', '/flyer-assets/photos/uploads/nature-extra-01-jHDH1dmH.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-MjhtSHj5', '/flyer-assets/photos/uploads/nature-extra-02-MjhtSHj5.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-LNY1xlnc', '/flyer-assets/photos/uploads/nature-extra-03-LNY1xlnc.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-AV9Y3kRc', '/flyer-assets/photos/uploads/nature-extra-04-AV9Y3kRc.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-gcKKWl8l', '/flyer-assets/photos/uploads/nature-extra-05-gcKKWl8l.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-1zeTJ0xQ', '/flyer-assets/photos/uploads/nature-extra-06-1zeTJ0xQ.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-fALRo-eQ', '/flyer-assets/photos/uploads/nature-extra-07-fALRo-eQ.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-Xw0mAWfm', '/flyer-assets/photos/uploads/nature-extra-08-Xw0mAWfm.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-rUutFzPB', '/flyer-assets/photos/uploads/nature-extra-09-rUutFzPB.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-j9U9yw5L', '/flyer-assets/photos/uploads/nature-extra-10-j9U9yw5L.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-cQZZo7wk', '/flyer-assets/photos/uploads/nature-extra-11-cQZZo7wk.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-JdTc42kV', '/flyer-assets/photos/uploads/nature-extra-12-JdTc42kV.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-wq4VwR1B', '/flyer-assets/photos/uploads/nature-extra-13-wq4VwR1B.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-OK3Zie1u', '/flyer-assets/photos/uploads/nature-extra-14-OK3Zie1u.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-GVBndyhJ', '/flyer-assets/photos/uploads/nature-extra-15-GVBndyhJ.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-G90Zr0zT', '/flyer-assets/photos/uploads/nature-extra-16-G90Zr0zT.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-BcEdFvKE', '/flyer-assets/photos/uploads/nature-extra-17-BcEdFvKE.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-HiW3AeTg', '/flyer-assets/photos/uploads/nature-extra-18-HiW3AeTg.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-RwnALkEs', '/flyer-assets/photos/uploads/nature-extra-19-RwnALkEs.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-mY7Bm6Is', '/flyer-assets/photos/uploads/nature-extra-20-mY7Bm6Is.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-wHhuWXGi', '/flyer-assets/photos/uploads/nature-extra-21-wHhuWXGi.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-KgPFs5TS', '/flyer-assets/photos/uploads/nature-extra-22-KgPFs5TS.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-f5idoAO4', '/flyer-assets/photos/uploads/nature-extra-23-f5idoAO4.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-mLN2qir5', '/flyer-assets/photos/uploads/nature-extra-24-mLN2qir5.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
    ('photo-nature-extra-FjcnbBwN', '/flyer-assets/photos/uploads/nature-extra-25-FjcnbBwN.jpg', '1:1', ['alam', 'indonesia', 'lanskap', 'lingkungan']),
]


def upgrade() -> None:
    bind = op.get_bind()
    # `id` is the primary key — ON CONFLICT DO NOTHING keeps the
    # migration idempotent if a partial seed already ran (e.g. local
    # dev DB was seeded ad-hoc before this migration landed).
    for asset_id, src, aspect, tags in SEED_PHOTOS:
        bind.execute(
            sa.text(
                "INSERT INTO flyer_assets (id, kind, src, aspect, tags) "
                "VALUES (:id, 'photo', :src, :aspect, :tags) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": asset_id, "src": src, "aspect": aspect, "tags": tags},
        )


def downgrade() -> None:
    # Drop only the bulk-seeded rows (originals stay; they have non-prefixed IDs).
    op.execute("DELETE FROM flyer_assets WHERE id LIKE 'photo-%-%'")
