/**
 * Hybrid Logical Clock.
 *
 * Wall-clock "last write wins" breaks when device clocks disagree, so events are
 * stamped with an HLC instead: it advances at least as fast as the local wall
 * clock, but never goes backwards, and observing a remote timestamp pulls the
 * local clock forward. Encoded as a fixed-width string so plain string
 * comparison gives the total order:
 *
 *   <physical ms, 15 digits>:<counter, 4 base36 digits>:<deviceId>
 *
 * The deviceId suffix breaks ties deterministically when two devices produce
 * the same (physical, counter) pair.
 */

const PHYS_WIDTH = 15;
const CTR_WIDTH = 4;

export function encodeHlc(physical: number, counter: number, deviceId: string): string {
  return [
    String(physical).padStart(PHYS_WIDTH, '0'),
    counter.toString(36).padStart(CTR_WIDTH, '0'),
    deviceId,
  ].join(':');
}

export function decodeHlc(hlc: string): { physical: number; counter: number; deviceId: string } {
  const [phys, ctr, ...device] = hlc.split(':');
  return {
    physical: parseInt(phys, 10),
    counter: parseInt(ctr, 36),
    deviceId: device.join(':'),
  };
}

/** Next HLC for an event created locally. */
export function hlcTick(prev: string | null, deviceId: string, wallMs: number): string {
  if (!prev) return encodeHlc(wallMs, 0, deviceId);
  const p = decodeHlc(prev);
  if (wallMs > p.physical) return encodeHlc(wallMs, 0, deviceId);
  return encodeHlc(p.physical, p.counter + 1, deviceId);
}

/** Merge a remote HLC into the local clock (on receiving synced events). */
export function hlcReceive(local: string | null, remote: string, deviceId: string, wallMs: number): string {
  const r = decodeHlc(remote);
  const l = local ? decodeHlc(local) : { physical: 0, counter: 0, deviceId };
  const physical = Math.max(wallMs, l.physical, r.physical);
  let counter: number;
  if (physical === l.physical && physical === r.physical) {
    counter = Math.max(l.counter, r.counter) + 1;
  } else if (physical === l.physical) {
    counter = l.counter + 1;
  } else if (physical === r.physical) {
    counter = r.counter + 1;
  } else {
    counter = 0;
  }
  return encodeHlc(physical, counter, deviceId);
}
