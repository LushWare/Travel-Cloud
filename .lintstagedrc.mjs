// Each package installs its own eslint independently (no npm workspace —
// see CLAUDE.md), so there's no hoisted binary to call from root. Route
// staged files to the eslint installed in their own package directory.
// Through node, not `bash -c`: GitHub Desktop on Windows resolves `bash` to WSL's.
const cmd = (dir) => (files) => ['node', 'scripts/eslint-in-package.mjs', dir, ...files]
  .map((part) => `"${part}"`)
  .join(' ');

export default {
  'Client/**/*.{js,jsx,ts,tsx}': cmd('Client'),
  'Management/**/*.{js,jsx}': cmd('Management'),
  'Landing/**/*.{js,jsx}': cmd('Landing'),
  'Services/shared/contracts/**/*.js': cmd('Services/shared/contracts'),
  'Services/lead-service/**/*.js': cmd('Services/lead-service'),
  'Services/billing-service/**/*.js': cmd('Services/billing-service'),
  'Services/package-service/**/*.js': cmd('Services/package-service'),
};
