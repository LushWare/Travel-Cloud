import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { theme as T } from '../config/pdfTheme.js';
import { loadRemoteImageBuffer } from './pdfImageLoader.js';
import { getOrgSettings } from '../config/orgSettings.js';
import { computeMargin } from '../../../shared/pricing-engine/src/index.js';

const asList = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);

const titleCase = (s) => String(s || '').replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', INR: 'INR ', AUD: 'A$', LKR: 'Rs ' };
const formatMoney = (amount, currency = 'USD') => {
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  return `${symbol}${(Number(amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * Render a Package (with its itineraryDays/places/activities/transports
 * included) to a branded, multi-page PDF Buffer. Visual system mirrors
 * billing-service's quotationPDFGenerator.js (rounded cards, hero banner,
 * chip rows, branded footer with page numbers) but only for content Package
 * actually has — no pricing breakdown, payment details, reviews, or contact
 * section, since none of that exists on this model.
 *
 * Every section degrades gracefully when its fields are absent, and image
 * loading never throws — a missing/unreachable coverImage always falls back
 * to a solid-color banner rather than failing PDF generation.
 *
 * @param {object} pkg - a Package row with `itineraryDays` (each including
 *   `places.place`, `activities.activity`, `transports`) included. Optional
 *   `coverImageBuffer` (Buffer) skips the remote fetch for a pre-resolved
 *   cover image.
 * @returns {Promise<Buffer>}
 */
export async function generatePackagePDF(pkg) {
  const days = Array.isArray(pkg.itineraryDays) ? pkg.itineraryDays : [];

  const [coverImageBuffer, CONTENT] = await Promise.all([
    pkg.coverImageBuffer ? Promise.resolve(pkg.coverImageBuffer) : loadRemoteImageBuffer(pkg.coverImage),
    getOrgSettings(),
  ]);
  // logoUrl only resolves to a Buffer when it's a remote http(s) URL —
  // loadRemoteImageBuffer returns null for a local path (or no logo), which
  // falls through to the fs.existsSync branch in drawLogoImage() below.
  const logoImageBuffer = await loadRemoteImageBuffer(CONTENT.logoUrl);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, left: 50, right: 50, bottom: 92 },
        bufferPages: true,
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PAGE_W = doc.page.width;
      const PAGE_H = doc.page.height;
      const left = doc.page.margins.left;
      const right = PAGE_W - doc.page.margins.right;
      const contentW = right - left;
      const FOOTER_H = 80;
      const footerTop = PAGE_H - FOOTER_H;
      const bottomLimit = PAGE_H - doc.page.margins.bottom;
      // Page-1 letterhead band (logo + company identity + address/contact),
      // full page width, ahead of the hero image. Pages 2+ reuse a shorter
      // band that fits inside the existing top margin so body content still
      // starts exactly at doc.page.margins.top.
      const HEADER_H = 78;
      const HEADER_H2 = doc.page.margins.top;

      // ── flow primitives ──────────────────────────────────────────
      const ensureSpace = (h) => { if (doc.y + h > bottomLimit) doc.addPage(); };

      // Vertically centers a stack of text lines as a single group within
      // [bandTop, bandTop + bandH), left-aligned at x. Each line's own
      // font/size/color is applied before measuring, so heights reflect what
      // will actually be drawn.
      const drawCenteredStack = (lines, x, bandTop, bandH, width) => {
        const GAP = 3;
        const withH = lines.map((l) => {
          doc.font(l.font).fontSize(l.size);
          return { ...l, h: doc.heightOfString(l.text, { width, lineBreak: false }) };
        });
        const totalH = withH.reduce((sum, l) => sum + l.h, 0) + GAP * (withH.length - 1);
        let y = bandTop + (bandH - totalH) / 2;
        for (const l of withH) {
          doc.font(l.font).fontSize(l.size).fillColor(l.color)
            .text(l.text, x, y, { width, lineBreak: false });
          y += l.h + GAP;
        }
      };

      // Draws a logo image vertically centered within [bandTop, bandTop +
      // bandH) at height logoH, preferring a pre-resolved remote Buffer
      // (logoImageBuffer) and falling back to a local filesystem path.
      // Returns true if an image was drawn (caller reserves LOGO_SLOT_W of
      // horizontal space next to it), false otherwise (no logo configured
      // or resolved — caller uses the full width for the text lockup).
      const drawLogoImage = (x, bandTop, bandH, logoH) => {
        const y = bandTop + (bandH - logoH) / 2;
        const url = CONTENT.logoUrl;
        const localPath = typeof url === 'string' && url && !/^https?:/i.test(url) && fs.existsSync(url) ? url : null;
        try {
          if (logoImageBuffer) {
            doc.image(logoImageBuffer, x, y, { height: logoH });
            return true;
          }
          if (localPath) {
            doc.image(localPath, x, y, { height: logoH });
            return true;
          }
        } catch { /* fall through to text-only lockup */ }
        return false;
      };

      const sectionHeader = (title) => {
        ensureSpace(48);
        doc.font('Helvetica-Bold').fontSize(14).fillColor(T.brand)
          .text(String(title).toUpperCase(), left, doc.y, { width: contentW });
        const ry = doc.y + 4;
        doc.moveTo(left, ry).lineTo(right, ry).lineWidth(2).strokeColor(T.brand).stroke();
        doc.lineWidth(1);
        doc.x = left;
        doc.y = ry + 14;
      };

      // ── Page-1 letterhead ──────────────────────────────────────────
      // Full-width band above the hero image: logo (vertically centered)
      // next to a vertically-centered identity lockup (company name,
      // tagline, address/contact) — the only place this PDF carries
      // full branding, since it's the customer's first look at the package,
      // before any quotation exists.
      const LOGO_SLOT_W = 100;
      const pageOneHeader = () => {
        const hasLogo = drawLogoImage(left, 0, HEADER_H, 32);
        const textX = hasLogo ? left + LOGO_SLOT_W : left;
        const contact = [CONTENT.companyAddress, CONTENT.contactPhone, CONTENT.contactEmail, CONTENT.website]
          .filter(Boolean).join('   |   ');
        const lines = [{ text: CONTENT.companyName, font: 'Helvetica-Bold', size: hasLogo ? 13 : 16, color: T.ink }];
        if (CONTENT.tagline) lines.push({ text: CONTENT.tagline, font: 'Helvetica', size: 9, color: T.muted });
        if (contact) lines.push({ text: contact, font: 'Helvetica', size: 7.5, color: T.muted });
        drawCenteredStack(lines, textX, 0, HEADER_H, right - textX);
        doc.rect(0, HEADER_H, PAGE_W, 1).fill(T.slate200);
      };

      // ── Running header (pages 2+) ────────────────────────────────
      // Lighter version of the letterhead — logo-or-name only, vertically
      // centered within the existing top margin so body content still
      // starts exactly at doc.page.margins.top.
      const RUNNING_LOGO_SLOT_W = 64;
      const drawRunningHeader = () => {
        const hasLogo = drawLogoImage(left, 0, HEADER_H2, 18);
        const textX = hasLogo ? left + RUNNING_LOGO_SLOT_W : left;
        drawCenteredStack(
          [{ text: CONTENT.companyName, font: 'Helvetica-Bold', size: 12, color: T.brand }],
          textX, 0, HEADER_H2, right - textX,
        );
      };

      // ── Cover ────────────────────────────────────────────────────
      const coverPage = () => {
        pageOneHeader();
        const heroTop = HEADER_H;
        const heroH = 260;
        let drew = false;
        const imgBuf = coverImageBuffer;
        const imgPath = typeof pkg.coverImage === 'string' && !/^https?:/i.test(pkg.coverImage)
          ? pkg.coverImage : null;
        try {
          if (imgBuf) {
            doc.image(imgBuf, left, heroTop, { width: contentW, height: heroH, cover: [contentW, heroH] });
            drew = true;
          } else if (imgPath && fs.existsSync(imgPath)) {
            doc.image(imgPath, left, heroTop, { width: contentW, height: heroH, cover: [contentW, heroH] });
            drew = true;
          }
        } catch { drew = false; }
        if (!drew) {
          doc.rect(left, heroTop, contentW, heroH).fill(T.brand);
          doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(30)
            .text((pkg.destination || pkg.title || 'Your Destination').toUpperCase(),
              left + 20, heroTop + heroH / 2 - 24, { width: contentW - 40, align: 'center' });
        }
        const cardY = heroTop + heroH + 30;
        const cardH = 172;
        doc.roundedRect(left, cardY, contentW, cardH, 12).fillAndStroke(T.white, T.slate200);
        doc.rect(left, cardY + 10, 6, cardH - 20).fill(T.brand);

        // Package name is the dominant marketing element on this page — it's
        // the first thing a customer sees, before any quotation exists —
        // so it's sized noticeably larger than quotation's 20pt cover title.
        doc.fillColor(T.ink).font('Helvetica-Bold').fontSize(27)
          .text(pkg.title || 'Travel Package', left + 24, cardY + 28, {
            width: contentW - 48, align: 'center',
          });

        if (pkg.destination) {
          doc.moveDown(0.4);
          doc.font('Helvetica-Bold').fontSize(13).fillColor(T.brand)
            .text(pkg.destination.toUpperCase(), left + 24, doc.y, { width: contentW - 48, align: 'center' });
        }

        // Compact stat row (Duration / Category / Travel Method / Starting
        // From) instead of a stacked key:value list — reads as a designed
        // summary bar and fills the card's width rather than sitting
        // left-aligned. Columns with no value are simply dropped and the
        // rest redistribute the width evenly.
        const stats = [];
        if (pkg.durationDays) stats.push(['DURATION', `${pkg.durationDays} Days`]);
        if (pkg.category) stats.push(['CATEGORY', titleCase(pkg.category)]);
        // Just the mode of transport (e.g. "Flight") — deliberately excludes
        // pricingModel ("Per Vehicle"/"Per Person"), which is pricing detail
        // that doesn't belong on the cover.
        const firstTransportMode = days.flatMap((d) => d.transports || []).map((t) => t.transportMode).find(Boolean);
        if (firstTransportMode) stats.push(['TRAVEL METHOD', titleCase(firstTransportMode)]);
        // The customer's price (cost + margin) — never the cost — per person,
        // twin sharing, the same figure the website and package card show.
        const sellPrice = pkg.sellPrice != null
          ? Number(pkg.sellPrice)
          : computeMargin(Number(pkg.basePrice) || 0, pkg.defaultMarginType, Number(pkg.defaultMarginInput) || 0).sellPrice;
        if (sellPrice > 0) {
          stats.push(['FROM / PERSON', formatMoney(sellPrice, pkg.currency)]);
        }
        doc.x = left;
        doc.y = cardY + cardH + 24;
        if (stats.length) {
          const statY = doc.y;
          const colW = contentW / stats.length;
          stats.forEach(([label, value], i) => {
            const x = left + i * colW;
            if (i > 0) {
              doc.moveTo(x, statY).lineTo(x, statY + 34).lineWidth(1).strokeColor(T.slate200).stroke();
            }
            doc.font('Helvetica-Bold').fontSize(8).fillColor(T.muted)
              .text(label, x, statY, { width: colW, align: 'center' });
            doc.font('Helvetica-Bold').fontSize(13).fillColor(T.ink)
              .text(value, x, statY + 14, { width: colW, align: 'center' });
          });
          doc.x = left;
          doc.y = statY + 44;
        }
        // Page 1 is the cover only — matches quotation's coverPage(), which
        // also ends with an unconditional page break.
        doc.addPage();
      };

      // ── Overview ───────────────────────────────────────────────
      const overviewSection = () => {
        if (!pkg.description) return;
        sectionHeader('Overview');
        doc.font('Helvetica').fontSize(10).fillColor(T.ink)
          .text(pkg.description, left, doc.y, { width: contentW, align: 'justify' });
        doc.moveDown(0.6);
      };

      // ── Itinerary day cards ──────────────────────────────────────
      // ItineraryDay has no image field (only Package.coverImage and the
      // package-level PackageImage[] gallery exist, neither of which maps to
      // a specific day) — every card renders text-only, same layout width as
      // quotation's no-image branch.
      const CARD_PAD = 14;
      const CHIP_H = 18;
      const CHIP_GAP = 6;

      const layoutChipRows = (items, maxWidth) => {
        const rows = [[]];
        let x = 0;
        for (const text of items) {
          const w = doc.widthOfString(text) + 16;
          if (x + w > maxWidth && rows[rows.length - 1].length > 0) {
            rows.push([]);
            x = 0;
          }
          rows[rows.length - 1].push({ text, w });
          x += w + CHIP_GAP;
        }
        return rows;
      };
      const chipRowsHeight = (rows) => rows.length * (CHIP_H + CHIP_GAP) - CHIP_GAP;
      const drawChipRows = (rows, x0, y0) => {
        doc.font('Helvetica-Bold').fontSize(8);
        let y = y0;
        for (const row of rows) {
          let x = x0;
          for (const { text, w } of row) {
            doc.roundedRect(x, y, w, CHIP_H, 9).fillOpacity(0.14).fill(T.brand).fillOpacity(1);
            doc.fillColor(T.brandDark).text(text, x, y + 4.5, { width: w, align: 'center' });
            x += w + CHIP_GAP;
          }
          y += CHIP_H + CHIP_GAP;
        }
        return y - CHIP_GAP;
      };

      const dayCard = (day, idx) => {
        const textX = left + CARD_PAD;
        const textW = contentW - CARD_PAD * 2;
        const badgeW = 34;
        const titleText = `Day ${day.dayNumber ?? idx + 1}${day.title ? ': ' + day.title : ''}`;

        const locationNames = asList((day.places || []).map((p) => p.place?.name || p.customName));
        const activityItems = (day.activities || [])
          .map((a) => ({ name: a.activity?.name, description: a.activity?.description }))
          .filter((a) => a.name);

        let transportText = null;
        if (day.transports?.length) {
          const t = day.transports[0];
          transportText = `Transport: ${titleCase(t.transportMode)} (${titleCase(t.pricingModel)})`;
        }
        const mealParts = [];
        if (day.breakfastCount > 0) mealParts.push(`${day.breakfastCount}x Breakfast`);
        if (day.lunchCount > 0) mealParts.push(`${day.lunchCount}x Lunch`);
        if (day.dinnerCount > 0) mealParts.push(`${day.dinnerCount}x Dinner`);
        const mealsText = mealParts.length ? `Meals: ${mealParts.join(', ')}` : null;

        // Dry-measure the card's content height before drawing its
        // background, so the background can be sized to fit.
        doc.font('Helvetica-Bold').fontSize(11);
        let textH = doc.heightOfString(titleText, { width: textW - badgeW });

        if (day.description) {
          doc.font('Helvetica').fontSize(9);
          textH += 6 + doc.heightOfString(day.description, { width: textW, align: 'justify' });
        }

        const locRows = locationNames.length ? layoutChipRows(locationNames, textW) : [];
        if (locRows.length) {
          doc.font('Helvetica-Bold').fontSize(9);
          textH += 10 + doc.heightOfString('LOCATIONS', { width: textW }) + chipRowsHeight(locRows);
        }

        if (activityItems.length) {
          doc.font('Helvetica-Bold').fontSize(9);
          textH += 10 + doc.heightOfString('ACTIVITIES', { width: textW });
          for (const a of activityItems) {
            doc.font('Helvetica-Bold').fontSize(9);
            let h = doc.heightOfString(a.name, { width: textW - 12 });
            if (a.description) {
              doc.font('Helvetica').fontSize(8);
              h += 2 + doc.heightOfString(a.description, { width: textW - 12 });
            }
            textH += h + 6;
          }
        }

        doc.font('Helvetica').fontSize(9);
        if (transportText) textH += 5 + doc.heightOfString(transportText, { width: textW });
        if (mealsText) textH += 5 + doc.heightOfString(mealsText, { width: textW });

        const cardH = textH + CARD_PAD * 2 + 4; // small cushion against rounding drift
        ensureSpace(cardH + 10);
        const startY = doc.y;

        doc.roundedRect(left, startY, contentW, cardH, 10).fillAndStroke(T.white, T.slate200);

        const cx = textX + 12;
        const cy = startY + CARD_PAD + 12;
        doc.circle(cx, cy, 12).fill(T.brand);
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11)
          .text(String(day.dayNumber ?? idx + 1), cx - 12, cy - 6, { width: 24, align: 'center' });

        const titleX = cx + 22;
        doc.fillColor(T.ink).font('Helvetica-Bold').fontSize(11)
          .text(titleText, titleX, cy - 6, { width: textX + textW - titleX });
        let yy = Math.max(doc.y, cy + 14) + 5;

        if (day.description) {
          doc.font('Helvetica').fontSize(9).fillColor(T.ink)
            .text(day.description, textX, yy, { width: textW, align: 'justify' });
          yy = doc.y + 6;
        }

        if (locRows.length) {
          doc.font('Helvetica-Bold').fontSize(9).fillColor(T.brand)
            .text('LOCATIONS', textX, yy, { width: textW });
          yy = doc.y + 4;
          yy = drawChipRows(locRows, textX, yy) + 5;
        }

        if (activityItems.length) {
          yy += 5;
          doc.font('Helvetica-Bold').fontSize(9).fillColor(T.brand)
            .text('ACTIVITIES', textX, yy, { width: textW });
          yy = doc.y + 4;
          for (const a of activityItems) {
            doc.circle(textX + 3, yy + 5, 2.5).fill(T.brand);
            const nameX = textX + 12;
            const nameW = textW - 12;
            doc.font('Helvetica-Bold').fontSize(9).fillColor(T.ink).text(a.name, nameX, yy, { width: nameW });
            yy = doc.y + 1;
            if (a.description) {
              doc.font('Helvetica').fontSize(8).fillColor(T.muted).text(a.description, nameX, yy, { width: nameW });
              yy = doc.y + 1;
            }
            yy += 6;
          }
        }

        doc.font('Helvetica').fontSize(9).fillColor(T.muted);
        if (transportText) { doc.text(transportText, textX, yy, { width: textW }); yy = doc.y + 5; }
        if (mealsText) { doc.text(mealsText, textX, yy, { width: textW }); yy = doc.y + 5; }

        doc.x = left;
        doc.y = startY + cardH + 10;
      };

      const itinerarySection = () => {
        if (!days.length) return;
        sectionHeader('Travel Itinerary');
        days.forEach(dayCard);
      };

      // ── Inclusions / exclusions (two columns) ────────────────────
      const inclusionsSection = () => {
        const inc = asList(pkg.inclusions);
        const exc = asList(pkg.exclusions);
        if (!inc.length && !exc.length) return;
        sectionHeader('Inclusions & Exclusions');

        const colGap = 20;
        const colW = (contentW - colGap) / 2;
        const rx = left + colW + colGap;
        const est = Math.max(inc.length, exc.length) * 13 + 30;
        ensureSpace(Math.min(est, 260));
        const startY = doc.y;

        const drawCol = (title, items, x) => {
          doc.font('Helvetica-Bold').fontSize(11).fillColor(T.brand).text(title, x, startY, { width: colW });
          let yy = doc.y + 4;
          doc.font('Helvetica').fontSize(9).fillColor(T.ink);
          for (const it of (items.length ? items : ['—'])) {
            doc.text(`•  ${it}`, x, yy, { width: colW });
            yy = doc.y + 2;
          }
          return yy;
        };
        const endL = drawCol('INCLUSIONS', inc, left);
        const endR = drawCol('EXCLUSIONS', exc, rx);
        doc.x = left;
        doc.y = Math.max(endL, endR) + 8;
      };

      // ── Terms & Conditions ─────────────────────────────────────
      const termsSection = () => {
        if (!pkg.termsAndConditions) return;
        sectionHeader('Terms & Conditions');
        doc.font('Helvetica').fontSize(9).fillColor(T.ink)
          .text(pkg.termsAndConditions, left, doc.y, { width: contentW });
        doc.moveDown(0.6);
      };

      // ── Per-page chrome: footer band + page numbers ───────────────
      // Company name is now the first line of the footer band on every
      // page (previously only the running header carried it, and only on
      // pages 2+) so it's present in both header and footer everywhere.
      const generatedOn = new Date().toLocaleDateString();
      const finalizeChrome = () => {
        const range = doc.bufferedPageRange();
        for (let i = 0; i < range.count; i += 1) {
          doc.switchToPage(range.start + i);
          doc.page.margins.bottom = 0;
          doc.rect(0, footerTop, PAGE_W, FOOTER_H).fill(T.brand);
          doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(9)
            .text(CONTENT.companyName, left, footerTop + 10, { width: contentW, align: 'center', lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(9)
            .text(CONTENT.ratingTagline, left, footerTop + 24, { width: contentW, align: 'center', lineBreak: false });
          doc.font('Helvetica').fontSize(8)
            .text(`Page ${i + 1} of ${range.count}`, left, footerTop + 40, { width: contentW, align: 'center', lineBreak: false });
          doc.font('Helvetica').fontSize(7)
            .text(`Generated on ${generatedOn}  |  Package ID: ${pkg.id}`, left, footerTop + 56, {
              width: contentW, align: 'center', lineBreak: false,
            });
          if (i > 0) drawRunningHeader();
        }
      };

      // ── Compose ──────────────────────────────────────────────────
      // Highlights (Overview) and Inclusions & Exclusions render before the
      // itinerary, so the day-by-day plan starts right after them instead of
      // waiting for a later page.
      coverPage();
      overviewSection();
      inclusionsSection();
      itinerarySection();
      termsSection();
      finalizeChrome();

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export default generatePackagePDF;
