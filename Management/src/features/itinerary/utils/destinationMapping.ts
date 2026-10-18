/**
 * Destination to Country Code Mapping
 * Used for context-aware location suggestions
 */

export const DESTINATION_COUNTRY_MAP = {
    // Middle East
    'Dubai': 'AE',
    'Abu Dhabi': 'AE',
    'Sharjah': 'AE',
    'Ajman': 'AE',
    'Ras Al Khaimah': 'AE',
    'Fujairah': 'AE',
    'Umm Al Quwain': 'AE',
    'Doha': 'QA',
    'Riyadh': 'SA',
    'Jeddah': 'SA',
    'Mecca': 'SA',
    'Medina': 'SA',
    'Muscat': 'OM',
    'Manama': 'BH',
    'Kuwait City': 'KW',
    'Beirut': 'LB',
    'Amman': 'JO',
    'Tel Aviv': 'IL',
    'Jerusalem': 'IL',

    // Southeast Asia
    'Bali': 'ID',
    'Jakarta': 'ID',
    'Yogyakarta': 'ID',
    'Lombok': 'ID',
    'Bandung': 'ID',
    'Bangkok': 'TH',
    'Phuket': 'TH',
    'Chiang Mai': 'TH',
    'Pattaya': 'TH',
    'Krabi': 'TH',
    'Koh Samui': 'TH',
    'Singapore': 'SG',
    'Kuala Lumpur': 'MY',
    'Penang': 'MY',
    'Langkawi': 'MY',
    'Hanoi': 'VN',
    'Ho Chi Minh': 'VN',
    'Saigon': 'VN',
    'Da Nang': 'VN',
    'Siem Reap': 'KH',
    'Phnom Penh': 'KH',
    'Vientiane': 'LA',
    'Yangon': 'MM',
    'Manila': 'PH',
    'Cebu': 'PH',
    'Boracay': 'PH',

    // South Asia
    'Colombo': 'LK',
    'Kandy': 'LK',
    'Galle': 'LK',
    'Ella': 'LK',
    'Nuwara Eliya': 'LK',
    'Sigiriya': 'LK',
    'Mirissa': 'LK',
    'Bentota': 'LK',

    'Kathmandu': 'NP',
    'Pokhara': 'NP',
    'Maldives': 'MV',
    'Male': 'MV',
    'Dhaka': 'BD',
    'Islamabad': 'PK',
    'Karachi': 'PK',
    'Lahore': 'PK',

    // Europe
    'Paris': 'FR',
    'Nice': 'FR',
    'Lyon': 'FR',
    'Marseille': 'FR',
    'Bordeaux': 'FR',
    'London': 'GB',
    'Edinburgh': 'GB',
    'Manchester': 'GB',
    'Liverpool': 'GB',
    'Oxford': 'GB',
    'Cambridge': 'GB',
    'Rome': 'IT',
    'Venice': 'IT',
    'Florence': 'IT',
    'Milan': 'IT',
    'Naples': 'IT',
    'Pisa': 'IT',
    'Barcelona': 'ES',
    'Madrid': 'ES',
    'Seville': 'ES',
    'Valencia': 'ES',
    'Granada': 'ES',
    'Amsterdam': 'NL',
    'Rotterdam': 'NL',
    'The Hague': 'NL',
    'Berlin': 'DE',
    'Munich': 'DE',
    'Frankfurt': 'DE',
    'Hamburg': 'DE',
    'Cologne': 'DE',
    'Vienna': 'AT',
    'Salzburg': 'AT',
    'Zurich': 'CH',
    'Geneva': 'CH',
    'Bern': 'CH',
    'Prague': 'CZ',
    'Budapest': 'HU',
    'Warsaw': 'PL',
    'Krakow': 'PL',
    'Athens': 'GR',
    'Santorini': 'GR',
    'Mykonos': 'GR',
    'Lisbon': 'PT',
    'Porto': 'PT',
    'Brussels': 'BE',
    'Copenhagen': 'DK',
    'Stockholm': 'SE',
    'Oslo': 'NO',
    'Helsinki': 'FI',
    'Reykjavik': 'IS',
    'Dublin': 'IE',
    'Moscow': 'RU',
    'St Petersburg': 'RU',
    'Istanbul': 'TR',
    'Antalya': 'TR',
    'Cappadocia': 'TR',

    // Americas
    'New York': 'US',
    'Los Angeles': 'US',
    'San Francisco': 'US',
    'Las Vegas': 'US',
    'Miami': 'US',
    'Orlando': 'US',
    'Chicago': 'US',
    'Boston': 'US',
    'Seattle': 'US',
    'Washington DC': 'US',
    'Hawaii': 'US',
    'Honolulu': 'US',
    'Toronto': 'CA',
    'Vancouver': 'CA',
    'Montreal': 'CA',
    'Quebec': 'CA',
    'Calgary': 'CA',
    'Mexico City': 'MX',
    'Cancun': 'MX',
    'Playa del Carmen': 'MX',
    'Tulum': 'MX',
    'Buenos Aires': 'AR',
    'Rio de Janeiro': 'BR',
    'Sao Paulo': 'BR',
    'Lima': 'PE',
    'Cusco': 'PE',
    'Machu Picchu': 'PE',
    'Santiago': 'CL',
    'Bogota': 'CO',
    'Cartagena': 'CO',

    // East Asia
    'Tokyo': 'JP',
    'Kyoto': 'JP',
    'Osaka': 'JP',
    'Hiroshima': 'JP',
    'Nara': 'JP',
    'Hokkaido': 'JP',
    'Seoul': 'KR',
    'Busan': 'KR',
    'Jeju': 'KR',
    'Hong Kong': 'HK',
    'Macau': 'MO',
    'Shanghai': 'CN',
    'Beijing': 'CN',
    'Xi\'an': 'CN',
    'Guangzhou': 'CN',
    'Shenzhen': 'CN',
    'Chengdu': 'CN',
    'Taipei': 'TW',

    // Oceania
    'Sydney': 'AU',
    'Melbourne': 'AU',
    'Brisbane': 'AU',
    'Perth': 'AU',
    'Gold Coast': 'AU',
    'Cairns': 'AU',
    'Adelaide': 'AU',
    'Auckland': 'NZ',
    'Wellington': 'NZ',
    'Queenstown': 'NZ',
    'Christchurch': 'NZ',
    'Fiji': 'FJ',
    'Tahiti': 'PF',
    'Bora Bora': 'PF',

    // Africa
    'Cape Town': 'ZA',
    'Johannesburg': 'ZA',
    'Durban': 'ZA',
    'Cairo': 'EG',
    'Luxor': 'EG',
    'Aswan': 'EG',
    'Marrakech': 'MA',
    'Casablanca': 'MA',
    'Fes': 'MA',
    'Nairobi': 'KE',
    'Mombasa': 'KE',
    'Zanzibar': 'TZ',
    'Victoria Falls': 'ZW',
    'Mauritius': 'MU',
    'Seychelles': 'SC',
    'Addis Ababa': 'ET',
    'Lagos': 'NG',
    'Accra': 'GH',
};

/**
 * Get country code from destination name
 * @param {string} destination - Destination name (e.g., "Dubai", "Bali")
 * @returns {string|null} - ISO 3166-1 alpha-2 country code (e.g., "AE", "ID") or null
 */
export const getCountryCodeFromDestination = (destination?: string | null): string | null => {
    if (!destination || typeof destination !== 'string') return null;

    const normalizedDestination = destination.trim();

    // Direct match (case-insensitive)
    for (const [city, code] of Object.entries(DESTINATION_COUNTRY_MAP)) {
        if (city.toLowerCase() === normalizedDestination.toLowerCase()) {
            return code;
        }
    }

    // Fuzzy match - check if destination contains any mapped city
    for (const [city, code] of Object.entries(DESTINATION_COUNTRY_MAP)) {
        if (normalizedDestination.toLowerCase().includes(city.toLowerCase())) {
            return code;
        }
    }

    // Check if destination is already a country code
    if (/^[A-Z]{2}$/i.test(normalizedDestination)) {
        return normalizedDestination.toUpperCase();
    }

    return null;
};

export const getMappedCityFromDestination = (
    destination?: string | null,
    countryCode?: string | null,
): string | null => {
    if (!destination || typeof destination !== 'string') return null;

    const normalizedDestination = destination.toLowerCase();
    const normalizedCountryCode = countryCode?.toUpperCase();
    const match = Object.entries(DESTINATION_COUNTRY_MAP).find(([city, code]) =>
        (!normalizedCountryCode || code === normalizedCountryCode)
        && normalizedDestination.includes(city.toLowerCase()),
    );

    return match?.[0] || null;
};

/**
 * Get region from destination
 * @param {string} destination - Destination name
 * @returns {string|null} - Region name or null
 */
export const getRegionFromDestination = (destination?: string | null): string | null => {
    const countryCode = getCountryCodeFromDestination(destination);
    if (!countryCode) return null;

    const REGION_MAP: Record<string, string> = {
        // Middle East
        'AE': 'Middle East', 'SA': 'Middle East', 'QA': 'Middle East',
        'OM': 'Middle East', 'BH': 'Middle East', 'KW': 'Middle East',
        'JO': 'Middle East', 'LB': 'Middle East', 'IL': 'Middle East',

        // Southeast Asia
        'ID': 'Southeast Asia', 'TH': 'Southeast Asia', 'SG': 'Southeast Asia',
        'MY': 'Southeast Asia', 'VN': 'Southeast Asia', 'PH': 'Southeast Asia',
        'KH': 'Southeast Asia', 'LA': 'Southeast Asia', 'MM': 'Southeast Asia',

        // South Asia
        'LK': 'South Asia', 'IN': 'South Asia', 'NP': 'South Asia',
        'MV': 'South Asia', 'BD': 'South Asia', 'PK': 'South Asia',

        // Europe
        'FR': 'Europe', 'GB': 'Europe', 'IT': 'Europe', 'ES': 'Europe',
        'NL': 'Europe', 'DE': 'Europe', 'AT': 'Europe', 'CH': 'Europe',
        'CZ': 'Europe', 'HU': 'Europe', 'PL': 'Europe', 'GR': 'Europe',
        'PT': 'Europe', 'BE': 'Europe', 'DK': 'Europe', 'SE': 'Europe',
        'NO': 'Europe', 'FI': 'Europe', 'IS': 'Europe', 'IE': 'Europe',
        'RU': 'Europe', 'TR': 'Europe',

        // Americas
        'US': 'North America', 'CA': 'North America', 'MX': 'North America',
        'AR': 'South America', 'BR': 'South America', 'PE': 'South America',
        'CL': 'South America', 'CO': 'South America',

        // East Asia
        'JP': 'East Asia', 'KR': 'East Asia', 'CN': 'East Asia',
        'HK': 'East Asia', 'MO': 'East Asia', 'TW': 'East Asia',

        // Oceania
        'AU': 'Oceania', 'NZ': 'Oceania', 'FJ': 'Oceania', 'PF': 'Oceania',

        // Africa
        'ZA': 'Africa', 'EG': 'Africa', 'MA': 'Africa', 'KE': 'Africa',
        'TZ': 'Africa', 'ZW': 'Africa', 'MU': 'Africa', 'SC': 'Africa',
        'ET': 'Africa', 'NG': 'Africa', 'GH': 'Africa',
    };

    return REGION_MAP[countryCode] || null;
};

export default {
    DESTINATION_COUNTRY_MAP,
    getCountryCodeFromDestination,
    getMappedCityFromDestination,
    getRegionFromDestination,
};
