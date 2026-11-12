import path from 'node:path';

// Each package installs its own eslint independently (no npm workspace —
// see CLAUDE.md), so there's no hoisted binary to call from root. Route
// staged files to the eslint installed in their own package directory.
const cmd = (dir) => (files) => {
  const eslint = path.resolve(dir, 'node_modules/eslint/bin/eslint.js').replaceAll('\\', '/');
  const config = path.resolve(dir, 'eslint.config.js').replaceAll('\\', '/');
  const paths = files.map((file) => `"${file.replaceAll('\\', '/')}"`).join(' ');
  return `node "${eslint}" --config "${config}" ${paths}`;
};

export default {
  'Client/**/*.{js,jsx,ts,tsx}': cmd('Client'),
  'Management/**/*.{js,jsx}': cmd('Management'),
  'Landing/**/*.{js,jsx}': cmd('Landing'),
  'Services/shared/contracts/**/*.js': cmd('Services/shared/contracts'),
  'Services/lead-service/**/*.js': cmd('Services/lead-service'),
  'Services/billing-service/**/*.js': cmd('Services/billing-service'),
  'Services/package-service/**/*.js': cmd('Services/package-service'),
};
