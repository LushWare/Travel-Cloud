import { useEffect, useState } from 'react';

// A tiny hash router: links work with the browser's back button and can be bookmarked,
// without adding a routing library for a handful of pages.
export type Route =
  | { page: 'overview' }
  | { page: 'agencies' }
  | { page: 'agency'; id: string }
  | { page: 'staff' }
  | { page: 'plans' }
  | { page: 'setup'; token: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'setup') return { page: 'setup', token: new URLSearchParams(query).get('token') ?? '' };
  if (parts[0] === 'staff') return { page: 'staff' };
  if (parts[0] === 'plans') return { page: 'plans' };
  if (parts[0] === 'agencies' && parts[1] && UUID.test(parts[1])) return { page: 'agency', id: parts[1] };
  if (parts[0] === 'agencies') return { page: 'agencies' };
  return { page: 'overview' };
}

export const hrefFor = (route: Route) =>
  route.page === 'agency' ? `#/agencies/${route.id}` : route.page === 'agencies' ? '#/agencies' : route.page === 'staff' ? '#/staff' : route.page === 'plans' ? '#/plans' : '#/';

export const navigate = (route: Route) => { window.location.hash = hrefFor(route); };

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
