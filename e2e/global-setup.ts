import { startHarness, type AppMode } from '../test/harness/harness.ts';

export default async function globalSetup(): Promise<() => Promise<void>> {
  const mode = (process.env.E2E_APP ?? 'node') as AppMode;
  const harness = await startHarness(mode, process.env.IMAGE ?? 'life-hub:test');
  return () => harness.stop();
}
