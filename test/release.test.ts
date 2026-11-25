import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bumpVersion, latestRelease, releaseChangelog, sectionNotes } from '../scripts/release.ts';

const read = (file: string) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const UNRELEASED = `# Changelog

## [Unreleased]

### Fixed

- Something.
`;

describe('release helper', () => {
  it('bumps plain semantic versions', () => {
    expect(bumpVersion('0.0.0', 'minor')).toBe('0.1.0');
    expect(bumpVersion('0.1.2', 'patch')).toBe('0.1.3');
    expect(bumpVersion('0.1.2', 'major')).toBe('1.0.0');
    expect(() => bumpVersion('0.1.2', 'mega')).toThrow(/Unknown kind/);
    expect(() => bumpVersion('1.0.0-rc.1', 'patch')).toThrow(/plain/);
  });

  it('moves [Unreleased] into a dated first release with a tag link', () => {
    const released = releaseChangelog(UNRELEASED, '0.1.0', '2026-11-25');
    expect(sectionNotes(released, 'Unreleased')).toBe('');
    expect(released).toContain('## [0.1.0] - 2026-11-25');
    expect(sectionNotes(released, '0.1.0')).toBe('### Fixed\n\n- Something.');
    expect(released).toContain('[Unreleased]: https://github.com/SG303/life-hub/compare/v0.1.0...HEAD');
    expect(released).toContain('[0.1.0]: https://github.com/SG303/life-hub/releases/tag/v0.1.0');
  });

  it('links later releases to the previous one and keeps older links', () => {
    const first = releaseChangelog(UNRELEASED, '0.1.0', '2026-11-25');
    const second = releaseChangelog(first.replace('## [Unreleased]', '## [Unreleased]\n\n- More.'), '0.1.1', '2026-11-26');
    expect(latestRelease(second)).toBe('0.1.1');
    expect(sectionNotes(second, '0.1.0')).toBe('### Fixed\n\n- Something.');
    expect(sectionNotes(second, '0.1.1')).toBe('- More.');
    expect(second).toContain('[Unreleased]: https://github.com/SG303/life-hub/compare/v0.1.1...HEAD');
    expect(second).toContain('[0.1.1]: https://github.com/SG303/life-hub/compare/v0.1.0...v0.1.1');
    expect(second).toContain('[0.1.0]: https://github.com/SG303/life-hub/releases/tag/v0.1.0');
  });

  it('refuses an empty [Unreleased] section and a version that already exists', () => {
    const released = releaseChangelog(UNRELEASED, '0.1.0', '2026-11-25');
    expect(() => releaseChangelog(released, '0.1.1', '2026-11-26')).toThrow(/Nothing to release/);
    expect(() => releaseChangelog(released.replace('## [Unreleased]', '## [Unreleased]\n\n- More.'), '0.1.0', '2026-11-26')).toThrow(
      /already has/,
    );
  });
});

describe('repository version', () => {
  it('agrees across package.json, package-lock.json and CHANGELOG.md', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, { version?: string }> };
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);
    expect(latestRelease(read('CHANGELOG.md'))).toBe(pkg.version);
    expect(sectionNotes(read('CHANGELOG.md'), pkg.version)).not.toBe('');
  });
});
