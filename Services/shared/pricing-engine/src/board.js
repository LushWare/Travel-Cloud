const NONE = { breakfast: false, lunch: false, dinner: false };

const PLANS = [
  { match: /^(ai|all[\s-]*inclusive)/, meals: { breakfast: true, lunch: true, dinner: true } },
  { match: /^(fb|full[\s-]*board)/, meals: { breakfast: true, lunch: true, dinner: true } },
  { match: /^(hb|half[\s-]*board)/, meals: { breakfast: true, lunch: false, dinner: true } },
  { match: /^(bb|b&b|bed\s*(&|and)\s*breakfast|breakfast)/, meals: { breakfast: true, lunch: false, dinner: false } },
  { match: /^(ro|room[\s-]*only|no\s*meals?)/, meals: NONE },
];

export function mealsIncludedByBoard(boardType) {
  if (!boardType || typeof boardType !== 'string') return NONE;
  const normalized = boardType.trim().toLowerCase();
  const plan = PLANS.find((p) => p.match.test(normalized));
  return plan ? plan.meals : NONE;
}

const boardOf = (day) => day?.boardType ?? day?.accommodation?.boardType ?? null;
const hasHotel = (day) => Boolean(boardOf(day)) || Number(day?.accommodation?.totalAmount) > 0;
export function chargeableMealDays(days = []) {
  return days.map((day, i) => {
    const previous = i > 0 ? days[i - 1] : null;
    const tonight = hasHotel(day) ? mealsIncludedByBoard(boardOf(day)) : NONE;
    const lastNight = previous && hasHotel(previous) ? mealsIncludedByBoard(boardOf(previous)) : NONE;

    const covered = (count, included) => (included ? Math.min(Number(count) || 0, 1) : 0);
    const includedMeals = {
      breakfast: covered(day.breakfastCount, lastNight.breakfast),
      lunch: covered(day.lunchCount, tonight.lunch),
      dinner: covered(day.dinnerCount, tonight.dinner),
    };
    return {
      ...day,
      breakfastCount: Math.max(0, (Number(day.breakfastCount) || 0) - includedMeals.breakfast),
      lunchCount: Math.max(0, (Number(day.lunchCount) || 0) - includedMeals.lunch),
      dinnerCount: Math.max(0, (Number(day.dinnerCount) || 0) - includedMeals.dinner),
      includedMeals,
    };
  });
}
