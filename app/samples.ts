/** Verified against the GitHub API on 2026-10-03: each pair is an adjacent stable release. */
export const SAMPLES = [
  { repo: 'pmndrs/zustand', base: 'v5.0.14', head: 'v5.0.15', blurb: 'State management for React' },
  { repo: 'sindresorhus/ky', base: 'v2.0.2', head: 'v2.1.0', blurb: 'Tiny fetch-based HTTP client' },
  { repo: 'axios/axios', base: 'v1.19.0', head: 'v1.20.0', blurb: 'Promise-based HTTP client' },
] as const;
