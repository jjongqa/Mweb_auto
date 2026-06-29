import os from "node:os";

export const dynamic = "force-dynamic";

/**
 * 로컬 네트워크 IP 주소를 찾아 반환.
 * 회의실에서 팀원들에게 공유할 URL을 만들 때 사용.
 */
export async function GET() {
  const interfaces = os.networkInterfaces();
  const candidates: { name: string; address: string }[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== "IPv4") continue;
      if (addr.internal) continue;
      // 로컬 네트워크 대역만 (10.x, 172.16-31.x, 192.168.x)
      if (
        addr.address.startsWith("10.") ||
        addr.address.startsWith("192.168.") ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(addr.address)
      ) {
        candidates.push({ name, address: addr.address });
      }
    }
  }

  return Response.json({ candidates });
}
