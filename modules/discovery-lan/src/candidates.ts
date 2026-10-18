const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** Private IPv4 ranges a home or office network uses. */
function privateSubnet(host: string): string | undefined {
  const m = IPV4.exec(host.trim());
  if (!m) return undefined;
  const [a, b] = [Number(m[1]), Number(m[2])];
  const lan = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  return lan ? `${m[1]}.${m[2]}.${m[3]}` : undefined;
}
/** Browsers do not reveal this computer's address, so the scan tries the subnets of any
 * hint first (the page's own host, an address typed into Join), then the usual home ones. */
export const COMMON_SUBNETS: readonly string[] = ['192.168.1', '192.168.0', '10.0.0', '192.168.178'];

/** Addresses to probe, most likely first, each as `host:port`. */
export function lanCandidates(hints: readonly string[], port: number): string[] {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid discovery port');
  const subnets: string[] = [];
  for (const hint of hints) {
    const host = hint.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/:].*$/, '');
    const subnet = privateSubnet(host);
    if (subnet && !subnets.includes(subnet)) subnets.push(subnet);
  }
  for (const subnet of COMMON_SUBNETS) if (!subnets.includes(subnet)) subnets.push(subnet);
  const out = [`localhost:${port}`];
  for (const subnet of subnets) for (let i = 1; i < 255; i++) out.push(`${subnet}.${i}:${port}`);
  return out;
}

