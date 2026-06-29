import { resumeDataRequest } from "@/lib/data-requests";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const extraInputs: Record<string, unknown> = {};

    const lacmsEmail = String(body.lacmsEmail || "").trim();
    const lacmsPassword = String(body.lacmsPassword || "");
    const memberNo = String(body.memberNo || "").trim();
    const dealProductNo = String(body.dealProductNo || "").trim();

    if (lacmsEmail) extraInputs.lacmsEmail = lacmsEmail;
    if (lacmsPassword) extraInputs.lacmsPassword = lacmsPassword;
    if (memberNo) extraInputs.memberNo = memberNo;
    if (dealProductNo) extraInputs.dealProductNo = dealProductNo;

    if (Object.keys(extraInputs).length === 0) {
      return Response.json({ ok: false, error: "추가 입력값이 필요합니다" }, { status: 400 });
    }

    const request = resumeDataRequest(
      id,
      extraInputs,
      "LACMS/주문 데이터 입력값을 반영해 워커가 자동 재시도합니다."
    );
    if (!request) return Response.json({ ok: false, error: "not found" }, { status: 404 });
    return Response.json({ ok: true, request });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
