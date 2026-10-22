const normalizeColumnName = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function mapGoogleAdsLead(payload) {
  const entries = Array.isArray(payload?.user_column_data) ? payload.user_column_data : [];
  const columns = entries.map((entry) => ({
    key: normalizeColumnName(entry.column_name || entry.column_id),
    value: String(entry.string_value || '').trim(),
    label: entry.column_name || entry.column_id || 'Answer',
  })).filter((entry) => entry.value);

  const find = (aliases) => columns.find(({ key }) => aliases.some((alias) => key === alias || key.includes(alias)))?.value || '';
  const fullName = find(['full_name', 'name']);
  const firstName = find(['first_name']);
  const lastName = find(['last_name']);
  const email = find(['email']);
  const phone = find(['phone_number', 'phone']);
  const destination = find(['destination', 'where_to_travel', 'travel_destination']);
  const rawTravelDate = find(['travel_date', 'departure_date', 'when_to_travel']);
  const travelersValue = find(['number_of_travelers', 'travelers', 'passengers', 'people']);
  const travelersMatch = travelersValue.match(/\d+/);
  const numberOfTravelers = travelersMatch ? Number.parseInt(travelersMatch[0], 10) : null;
  const budget = find(['budget', 'spend']);
  const knownValues = new Set([fullName, firstName, lastName, email, phone, destination, rawTravelDate, travelersValue, budget]);
  const extraAnswers = columns
    .filter(({ value }) => !knownValues.has(value))
    .map(({ label, value }) => `${label}: ${value}`);
  const metadata = [
    payload.campaign_id ? `Google Ads campaign ${payload.campaign_id}` : null,
    payload.form_id ? `Lead form ${payload.form_id}` : null,
    ...extraAnswers,
  ].filter(Boolean);
  const parsedTravelDate = rawTravelDate ? new Date(rawTravelDate) : null;

  return {
    leadId: String(payload.lead_id || ''),
    isTest: payload.is_test === true || payload.is_test === 'true' || payload.is_test === 1,
    name: fullName || [firstName, lastName].filter(Boolean).join(' '),
    email: email || null,
    phone: phone || null,
    destination: destination || null,
    travelDate: parsedTravelDate && !Number.isNaN(parsedTravelDate.getTime()) ? parsedTravelDate.toISOString() : null,
    numberOfTravelers: Number.isSafeInteger(numberOfTravelers) && numberOfTravelers > 0 ? numberOfTravelers : null,
    budget: budget || null,
    message: metadata.join('; ') || null,
  };
}