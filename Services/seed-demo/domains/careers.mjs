/**
 * crm_careers — the Management Career page: open vacancies and the applicant
 * pipeline behind them.
 *
 * Neither table has a unique key, so this module owns them outright: every run
 * deletes the rows carrying its own id prefix and writes a fresh set (the same
 * prefix lib/reset.mjs recognises, which is what keeps a re-run idempotent).
 * An application is linked to a vacancy only by its `position` string — that
 * is all the UI matches on — so the position assigned here is always copied
 * from a vacancy this same run created, and a tag can never point at a job
 * that is not on the page.
 */
import { APPLICANT_COVER_LETTERS, APPLICANT_NAMES, VACANCIES } from '../lib/fixtures.mjs';
import { CATEGORIES, ownedPrefix } from '../lib/ids.mjs';
import { addDays } from '../lib/rng.mjs';

/** Recruiter one-liners per reviewed state; a pending application has no note. */
const REVIEW_NOTES = {
  under_review: [
    'CV is a good match — booking a first call.',
    'Relevant background; chasing references before a decision.',
    'Solid experience, confirming salary expectations this week.',
  ],
  shortlisted: [
    'Strong itinerary knowledge. Moved to a panel interview.',
    'Best writing sample of the intake — shortlisted.',
    'Good cultural fit; second interview scheduled.',
  ],
  rejected: [
    'Not enough luxury leisure exposure for this desk.',
    'Strong on paper but the salary band did not match.',
    'Withdrew after accepting another offer.',
  ],
  hired: [
    'Offer accepted; joins the Colombo desk next month.',
    'Hired — starts after a four-week notice period.',
  ],
};

export async function seed(ctx) {
  const { db, ids, now, log, data } = ctx;
  // Its own PRNG stream, so this step's output cannot be reshuffled by a
  // conditional draw added in an earlier domain (see lib/rng.mjs).
  const rng = ctx.rngFor('careers');
  const admins = data.users?.admins ?? [];
  if (!admins.length) throw new Error('careers: no admins available — run the users step first');
  const adminId = () => rng.pick(admins).id;
  /** Nothing that already happened may read as a future timestamp. */
  const clampNow = (d) => (d > now ? new Date(now) : d);

  await db.sql.query('DELETE FROM crm_careers."Career" WHERE id LIKE $1', [`${ownedPrefix('career')}%`]);
  await db.sql.query('DELETE FROM crm_careers."Vacancy" WHERE id LIKE $1', [`${ownedPrefix('vacancy')}%`]);

  // ── Vacancies ─────────────────────────────────────────────────────────────
  // A closed role's dates are pushed into the past so the "Closed" filter has
  // real history; an active one closes one to four months out.
  const vacancies = VACANCIES.map((v) => {
    let createdAt;
    let closingDate;
    if (v.status === 'closed') {
      closingDate = addDays(now, -rng.int(1, 45));
      createdAt = addDays(closingDate, -rng.int(30, 90));
    } else if (v.status === 'active') {
      createdAt = addDays(now, -rng.int(15, 75));
      closingDate = addDays(now, rng.int(30, 120));
    } else {
      createdAt = addDays(now, -rng.int(0, 30));
      closingDate = null;
    }
    return {
      id: ids.next('vacancy'),
      position: v.position,
      description: v.description,
      type: v.type,
      location: v.location,
      experienceMin: v.experienceMin,
      status: v.status,
      applicationsCount: 0, // backfilled from the applications below
      createdById: adminId(),
      closingDate,
      createdAt,
      updatedAt: createdAt,
    };
  });

  // The older seed wrote its own postings for these same roles. A vacancy has
  // no unique key, so those rows are invisible to the prefix delete above and
  // would leave every job advertised twice on the Careers page — the posting
  // this run owns supersedes any earlier row with the same natural key. Done
  // through Prisma rather than raw SQL because `type` is a VacancyType enum the
  // fixtures spell `Full_Time` and the database stores as `Full Time`.
  await db.career.vacancy.deleteMany({
    where: {
      AND: [
        { NOT: { id: { startsWith: ownedPrefix('vacancy') } } },
        { OR: vacancies.map((v) => ({ position: v.position, location: v.location, type: v.type })) },
      ],
    },
  });

  await db.career.vacancy.createMany({ data: vacancies, skipDuplicates: true });

  // ── Applications ──────────────────────────────────────────────────────────
  const total = rng.int(40, 60);
  const hired = Math.max(2, Math.round(total * 0.12));
  const shortlisted = Math.max(3, Math.round(total * 0.16));
  const rejected = Math.max(4, Math.round(total * 0.22));
  const underReview = Math.max(4, Math.round(total * 0.22));
  const pending = total - hired - shortlisted - rejected - underReview;

  // Every status is guaranteed a seat, then shuffled so the pipeline is not
  // laid out in blocks.
  const statuses = rng.sample(
    [
      ...Array(pending).fill('pending'),
      ...Array(underReview).fill('under_review'),
      ...Array(shortlisted).fill('shortlisted'),
      ...Array(rejected).fill('rejected'),
      ...Array(hired).fill('hired'),
    ],
    total,
  );

  // Each vacancy gets at least one applicant (so no posting looks dead), then
  // the remainder is weighted so a popular role draws a crowd. A final shuffle
  // decouples application order from the vacancy list.
  const positions = vacancies.map((v) => v.position);
  const weightedPositions = positions.map((p) => [p, rng.int(1, 4)]);
  const appliedTo = rng.sample(positions, positions.length);
  while (appliedTo.length < total) appliedTo.push(rng.weighted(weightedPositions));
  const assignment = rng.sample(appliedTo, appliedTo.length);

  // Applicants cycle through a reshuffled name list: one person may apply to
  // more than one role, which is why the fixture pool is reused — but never
  // twice for the same role, which would read as a data-entry error rather
  // than a pipeline. The pool is far smaller than the application count, so
  // the pairing is de-duplicated as it is drawn.
  let namePool = rng.sample(APPLICANT_NAMES, APPLICANT_NAMES.length);
  const applications = [];
  const claimed = new Set();
  for (let i = 0; i < total; i += 1) {
    if (!namePool.length) namePool = rng.sample(APPLICANT_NAMES, APPLICANT_NAMES.length);
    const applicant = namePool.pop();
    const status = statuses[i];
    let position = assignment[i];
    if (claimed.has(`${applicant.email}|${position}`)) {
      const from = positions.indexOf(position);
      for (let k = 1; k <= positions.length; k += 1) {
        const candidate = positions[(from + k) % positions.length];
        if (!claimed.has(`${applicant.email}|${candidate}`)) {
          position = candidate;
          break;
        }
      }
    }
    claimed.add(`${applicant.email}|${position}`);
    const reviewed = status !== 'pending';
    const createdAt = addDays(now, -rng.int(0, 240)); // spread over ~8 months
    const reviewedAt = reviewed ? clampNow(addDays(createdAt, rng.int(1, 18))) : null;
    const sent = status === 'pending' ? false : status === 'under_review' ? rng.chance(0.35) : true;
    const slug = slugify(applicant.name);

    applications.push({
      id: ids.next('career'),
      fullName: applicant.name,
      email: applicant.email,
      phone: applicant.phone,
      position,
      resumeUrl: `https://resumes.lushtravelcloud.com/${slug}.pdf`,
      resumeFileName: `${slug}-CV.pdf`,
      coverLetter: rng.pick(APPLICANT_COVER_LETTERS),
      agreeTerms: rng.chance(0.96),
      status,
      adminNotes: reviewed ? rng.pick(REVIEW_NOTES[status]) : null,
      reviewedById: reviewed ? adminId() : null,
      reviewedAt,
      emailSent: sent,
      emailSentAt: sent ? clampNow(addDays(reviewedAt, rng.int(0, 3))) : null,
      createdAt,
      updatedAt: reviewedAt ?? clampNow(addDays(createdAt, rng.int(0, 3))),
    });
  }

  // Same supersession for applications, keyed on the applicant rather than the
  // applicant-and-role pair: the older seed wrote these same fixture people
  // against whichever role it drew, so matching on the pair alone leaves the
  // person on the page twice — once per role.
  await db.career.career.deleteMany({
    where: {
      AND: [
        { NOT: { id: { startsWith: ownedPrefix('career') } } },
        { email: { in: [...new Set(applications.map((a) => a.email))] } },
      ],
    },
  });

  await db.career.career.createMany({ data: applications, skipDuplicates: true });

  // applicationsCount is denormalised — the Management page reads it without
  // touching the applications table, so keep it truthful after the insert.
  const perPosition = new Map();
  for (const a of applications) perPosition.set(a.position, (perPosition.get(a.position) ?? 0) + 1);
  for (const v of vacancies) {
    v.applicationsCount = perPosition.get(v.position) ?? 0;
    await db.career.vacancy.update({ where: { id: v.id }, data: { applicationsCount: v.applicationsCount } });
  }

  const byStatus = applications.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  log(`    careers: ${vacancies.length} vacancies, ${applications.length} applications`);

  return {
    summary: `${vacancies.length} vacancies · ${applications.length} applications (${Object.entries(byStatus).map(([s, n]) => `${s} ${n}`).join(', ')})`,
    vacancies: vacancies.map((v) => ({ id: v.id, position: v.position })),
    applications: byStatus,
  };
}

/** 'Anushka Fernando' → 'anushka-fernando', the shape the résumé CDN uses. */
function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
