import Link from "next/link";
import { GuideShell, StepCard, Howto, Code, Preview, Faq, Note, Card } from "../_components";

export const dynamic = "force-dynamic";

export default function TestDataGuide() {
  return (
    <GuideShell
      title="🧪 테스트 데이터 생성 사용법"
      subtitle="회원 / 주문 / 상품 / 프로모션 데이터를 API·DB 직접 호출로 한 번에 N건 생성합니다. UI 자동화 대비 30~100배 빠름."
      meta={
        <>
          <strong>⏱ 예상 소요시간:</strong> 메뉴별 1~5분 (3P/주문은 폴링 포함 더 걸림)
          <br />
          <strong>📦 필요한 것:</strong> stg lacms 계정(상품·쿠폰·할인·프로모션) · OpenAPI 토큰+어드민(3P) · 회원번호(주문)
          <br />
          <strong>🎯 누가 쓰나:</strong> 테스트 사전 데이터를 빠르게 만들고 싶은 모든 QA
        </>
      }
    >
      <Card>
        <h2 className="text-base font-semibold">📋 메뉴 한눈에 (도메인별 4그룹 · 10종)</h2>
        <div className="mt-2 grid grid-cols-1 gap-3 text-sm text-neutral-700 md:grid-cols-2">
          <div>
            <div className="font-semibold text-neutral-800">👤 회원</div>
            <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs">
              <li><strong>회원 계정 생성</strong> — 테스트 회원 N건 (옵션: 멤버스 자동 구독)</li>
              <li><strong>멤버스 강제 구독 / 해지</strong> — 여러 회원 일괄</li>
              <li><strong>🎟️ 멤버스 이용권 등록</strong> — 무료이용권 직접 등록 <em>(신규)</em></li>
              <li><strong>👑 VIP / VVIP 세팅</strong> — DB 직접 등급 부여 <em>(신규)</em></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-neutral-800">🛒 주문</div>
            <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs">
              <li><strong>주문 생성</strong> — 상품 생성 → 그 상품으로 주문 풀체인 (쿠키리스)</li>
              <li><strong>🧩 혼합 주문</strong> — 1P + 3P 유형 자유 조합 → 한 주문 <em>(신규)</em></li>
              <li><strong>적립금 지급</strong> — 회원에게 적립금 강제 지급</li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-neutral-800">📦 상품</div>
            <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs">
              <li><strong>상품 등록</strong> — 1P(직매입) / 3P(10종) + 재고 + 전시</li>
              <li><strong>상품 할인 적용</strong> — 딜상품×센터 정률/정액 일괄 <em>(가이드 추가)</em></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold text-neutral-800">🎯 프로모션</div>
            <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs">
              <li><strong>쿠폰 발행</strong> — 장바구니/상품/배송비 쿠폰 N건</li>
              <li><strong>프로모션 확정</strong> — 등록된 코드 API 일괄 확정</li>
            </ul>
          </div>
        </div>
        <Note variant="info" title="인증 한눈에">
          대부분 <strong>lacms 이메일/패스워드</strong>만 입력하면 서버가 OAuth 토큰을 자동 발급합니다(번들·네트워크탭 복사 불필요). 3P는 OpenAPI 토큰+어드민이 추가로 필요하고, <strong>주문은 회원번호(memberNo)만</strong>으로 됩니다(쿠키리스). 회원·적립금·VIP는 인증조차 없습니다.
        </Note>
      </Card>

      {/* ============ 회원 ============ */}
      <StepCard num={1} title="👤 회원 계정 생성">
        <p className="text-sm text-neutral-700"><Link href="/test-data/account" className="text-kurly-500 underline">/test-data/account</Link> · 인증 불필요</p>
        <Howto>
          <li>아이디 prefix(영숫자 6자 이하) / 이메일 도메인 / 이름 prefix / 공통 비밀번호 / 가입 경로 입력</li>
          <li><strong>생성 개수</strong>(1~500) + 동시 처리 수(1~20)</li>
          <li>(옵션) <strong>"가입 후 멤버스 무료이용권 자동 구독"</strong> → 가입 직후 1개월권 자동 구독</li>
          <li>실행 → 결과표(email / password / user_id) · CSV 다운로드</li>
        </Howto>
        <Note variant="info" title="stg mock 인증">
          모바일 <Code>01011111111</Code> / 인증코드 <Code>111111</Code> 고정. 같은 번호로 N명 가입 가능(번호별 락으로 직렬 처리).
        </Note>
      </StepCard>

      <StepCard num={2} title="🎫 멤버스 강제 구독 / 해지">
        <p className="text-sm text-neutral-700"><Link href="/test-data/membership" className="text-kurly-500 underline">/test-data/membership</Link> · 구독: 인증 없음 / 해지: lacms</p>
        <Howto>
          <li>탭 전환: <strong>강제 구독</strong> / <strong>강제 해지</strong></li>
          <li>회원번호 여러 개(줄/쉼표 구분, 최대 100명)</li>
          <li>구독 시 <strong>ticketMetaId</strong> 7종 드롭다운 선택(개월 수 자동 계산, 이번 달 1일~N개월 후 말일)</li>
          <li>해지 시 <strong>lacms 이메일/패스워드</strong> 필요(admin 권한)</li>
        </Howto>
        <Note variant="info">구독은 No-Auth API. 해지가 422여도 정상인 경우 있음(이미 비구독 등).</Note>
      </StepCard>

      <StepCard num={3} title="👑 VIP / VVIP 세팅 (신규)">
        <p className="text-sm text-neutral-700"><Link href="/test-data/vip" className="text-kurly-500 underline">/test-data/vip</Link> · DB 직접 적용(인증 없음)</p>
        <p className="text-sm text-neutral-700"><Code>kurlydotcom.mk_member_vip</Code> 테이블에 등급을 강제로 넣습니다.</p>
        <Howto>
          <li>회원번호 여러 개(줄/쉼표 구분, 최대 100명)</li>
          <li>등급 <strong>VVIP / VIP</strong> + 시작일 / 만료일</li>
          <li>실행 → 회원별 추가/갱신 결과(id) 표시</li>
        </Howto>
        <Note variant="info">
          같은 회원번호가 이미 있으면 <strong>기존 행을 갱신(UPSERT)</strong> — 재실행해도 중복 안 생김. 약 즉시 반영.
        </Note>
      </StepCard>

      {/* ============ 주문 ============ */}
      <StepCard num={4} title="🛒 주문 생성 (상품 생성 → 주문 풀체인)">
        <p className="text-sm text-neutral-700"><Link href="/test-data/order" className="text-kurly-500 underline">/test-data/order</Link> · 주문 인증 = 회원번호(memberNo)만</p>
        <p className="text-sm text-neutral-700"><strong>상품 생성 직후 → 그 상품으로 주문까지</strong> 한 페이지에서 풀체인 자동화.</p>
        <Howto>
          <li>① 상품 종류 선택 (1P / 3P)</li>
          <li>② 인증 — 1P: <strong>lacms 이메일/패스워드</strong> · 3P: <strong>OpenAPI 토큰 + 어드민 ID/PW</strong>(+ 전시/재고용 lacms)</li>
          <li>③ <strong>회원번호(memberNo)</strong> 입력 — 주문 인증은 이거 하나</li>
          <li>④ 상품 옵션(가격·재고·수량) + 결제수단(기본 적립금)</li>
          <li>⑤ (선택) 배송지 — 비우면 회원 기본배송지 + 센터코드 자동 조회</li>
          <li>⑥ (3P 전용) <strong>🚚 주문 직후 배송완료까지 자동 처리</strong> 체크 가능</li>
          <li>실행 → 풀체인(상품 생성 → 장바구니 → 주문서 진입 → 결제금액 계산 → 가주문 → 결제 완료)</li>
        </Howto>
        <Note variant="success" title="쿠키리스로 전환됨">
          예전의 <Code>ksi/kdi/krt</Code> 쿠키 복사·리캡차 로그인은 <strong>전부 제거</strong>됐어요. 이제 내부 게이트웨이가 <Code>X-KURLY-MEMBER-NO</Code> 헤더(회원번호)만으로 인증합니다.
        </Note>
        <Note variant="info" title="3P 배송완료 자동화">
          체크 시 OpenAPI 토큰으로 <strong>발주확인 → 발송처리 → 배송완료(Kafka TRACE)</strong>까지. <strong>일반(택배)</strong> 상품만 발송처리 가능. 3P는 전시→goods 반영에 최대 ~84초 폴링 후 실 dealProductNo로 변환합니다(지연 시 잠시 후 재실행 권장).
        </Note>
        <Note variant="warn" title="적립금 부족 시">
          적립금 전액 결제라 잔액 부족하면 실패. <strong>적립금 지급</strong>으로 먼저 충전하세요.
        </Note>
      </StepCard>

      <StepCard num={5} title="🧩 혼합 주문 (1P + 3P 유형 자유) (신규)">
        <p className="text-sm text-neutral-700"><Link href="/test-data/mixed-order" className="text-kurly-500 underline">/test-data/mixed-order</Link></p>
        <p className="text-sm text-neutral-700">타입별 상품을 자동 생성하고 <strong>한 주문(groupOrderNo)</strong>에 묶습니다. 컬리몰이 배송그룹을 자동 분리해요.</p>
        <Howto>
          <li>회원번호 + <strong>1P 개수</strong> + <strong>3P 유형별 행</strong>(일반택배 / 컬리배송 샛별·주류) 추가</li>
          <li>인증: <strong>lacms 공통 필수</strong>(전시 있어야 주문 가능) · 3P 포함 시 OpenAPI+어드민 추가</li>
          <li>실행 → 상품 생성 → 딜코드 변환 → 전부 한 카트 → 단일 주문</li>
        </Howto>
        <Note variant="info">
          예) <Code>1P 1 + 일반택배 1 + 컬리배송 1</Code>. 배송완료 자동화는 <strong>3P가 전부 일반(택배)</strong>일 때만(발송처리가 일반택배 배치). 비물류 유형은 혼합 주문 대상에서 제외돼 있어요.
        </Note>
      </StepCard>

      <StepCard num={6} title="💰 적립금 지급">
        <p className="text-sm text-neutral-700"><Link href="/test-data/point" className="text-kurly-500 underline">/test-data/point</Link> · 인증 불필요(stg test 전용 API)</p>
        <Howto>
          <li><strong>회원번호</strong> + <strong>금액</strong>(1~1억) + <strong>지급 건수</strong>(같은 회원에 N회 반복, 1~100)</li>
          <li><strong>유효 기간</strong>(기본 365일, 해당일 23:59:59 KST 만료)</li>
          <li>memo / detail / 지급자 회원번호(기본값 있음)</li>
        </Howto>
        <Note variant="info"><Code>point.stg.kurlypay.services</Code> test 전용 — <strong>production 영향 없음</strong>. 즉시 처리.</Note>
      </StepCard>

      {/* ============ 상품 ============ */}
      <StepCard num={7} title="📦 상품 등록 (1P / 3P)">
        <p className="text-sm text-neutral-700">
          <Link href="/test-data/product/1p" className="text-kurly-500 underline">/test-data/product/1p</Link> (Kurly 직매입) ·{" "}
          <Link href="/test-data/product/3p" className="text-kurly-500 underline">/test-data/product/3p</Link> (파트너)
        </p>

        <div className="mt-2 rounded border border-emerald-200 bg-emerald-50/40 p-3">
          <strong className="text-sm">🏬 1P (직매입) — 5단계 · ~2~3초/건 · 최대 50건</strong>
          <ul className="mt-1 ml-5 list-disc text-xs text-neutral-700 space-y-0.5">
            <li>인증: <strong>lacms 이메일/패스워드</strong></li>
            <li>OAuth → 마스터 → 콘텐츠 → 9개 센터 재고 → La-CMS 전시(isShow=true)</li>
          </ul>
        </div>

        <div className="mt-2 rounded border border-violet-200 bg-violet-50/40 p-3">
          <strong className="text-sm">🤝 3P (파트너) — 12단계 · ~15~20초/건 · 10가지 유형</strong>
          <ul className="mt-1 ml-5 list-disc text-xs text-neutral-700 space-y-0.5">
            <li>인증: <strong>OpenAPI 토큰 + 어드민 ID/PW</strong> (+ 전시/재고용 lacms)</li>
            <li>유형: 일반(택배) / 컬리배송(샛별·주류) / 설치 / 미식 / 퀵 / 숙박 / 항공권 / 온라인티켓 / 셀프픽업</li>
            <li>사전조회(출고지·반품지·배송사) → 등록 → <strong>어드민 승인 폴링(3초×12 ≈ 36초)</strong> → La-CMS 전시/재고</li>
          </ul>
        </div>
      </StepCard>

      <StepCard num={8} title="🏷️ 상품 할인 적용">
        <p className="text-sm text-neutral-700"><Link href="/test-data/discount" className="text-kurly-500 underline">/test-data/discount</Link> · lacms OAuth + X-KURLY-CMS-USER</p>
        <Howto>
          <li><strong>lacms 이메일/패스워드</strong>(JWT 자동 발급)</li>
          <li><strong>dealProductNo</strong>(쉼표/줄 구분) × <strong>센터코드</strong>(기본 CC02) — 조합 수만큼 일괄 등록</li>
          <li>할인 유형(정률 PERCENTAGE / 정액 AMOUNT) + 값 + 기간(일)</li>
          <li>discountKind: STANDARD / SINGLE_BUNDLE(번들은 조건수량 최소 2 자동)</li>
        </Howto>
        <Note variant="info">
          <Code>X-KURLY-CMS-USER</Code>는 보통 JWT 클레임에서 자동 생성(<Code>mno:email:name</Code> base64). 401 뜰 때만 lacms 네트워크탭에서 복사해 수동 입력.
        </Note>
      </StepCard>

      {/* ============ 프로모션 ============ */}
      <StepCard num={9} title="🎟️ 쿠폰 발행">
        <p className="text-sm text-neutral-700"><Link href="/test-data/coupon" className="text-kurly-500 underline">/test-data/coupon</Link> · lacms OAuth(JWT 자동)</p>
        <Howto>
          <li><strong>lacms 이메일 + 패스워드</strong>(이메일은 저장됨, 패스워드는 저장 안 함)</li>
          <li>쿠폰 종류(CART / FREE_SHIPPING / PRODUCT) + 발급 방식(DOWNLOAD / ADMIN)</li>
          <li>할인 유형(정액 / 정률 + 최대할인) + 금액/율 + 유효기간(1~365)</li>
          <li>(선택) <strong>발급 대상 회원번호</strong> 입력 시 자동 ADMIN 발급 — CSV 업로드 후 발급 실행</li>
        </Howto>
        <Note variant="info">
          PRODUCT 쿠폰은 sales_owner ALL만 가능(KURLY면 422). X-KURLY-CMS-USER는 보통 불필요(401 시 고급 옵션에서 수동).
        </Note>
      </StepCard>

      <StepCard num={10} title="🎯 프로모션 확정">
        <p className="text-sm text-neutral-700"><Link href="/test-data/promotion" className="text-kurly-500 underline">/test-data/promotion</Link> · lacms OAuth + promotion-user 헤더</p>
        <Howto>
          <li><strong>lacms 이메일 + 패스워드</strong> (groupType <Code>Marketing_ALL</Code> 권한 필요)</li>
          <li>프로모션 코드 textarea(줄/쉼표/공백 구분, 1~50개)</li>
          <li>실행 → 코드별 <strong>4개 90일 창 스캔</strong>(최근→과거→미래)으로 promotionId 추출 → PUT confirm</li>
          <li>결과표: 코드 / promotionId / 제목 / 검토상태 / 확정 여부 / 오류</li>
        </Howto>
        <Note variant="info">확정 후 약 <strong>5분 경과</strong> 시 공급사 판촉합의서 날인 가능.</Note>
      </StepCard>

      <Card>
        <h2 className="text-base font-semibold">🎯 추천 시나리오 — 풀체인 자동화</h2>
        <p className="mt-2 text-sm text-neutral-700">테스트 직전 사전 데이터 셋업의 황금 순서:</p>
        <ol className="mt-2 ml-5 list-decimal text-sm text-neutral-700 space-y-1.5">
          <li><Link href="/test-data/account" className="text-kurly-500 underline">회원 N명 생성</Link> (옵션: 멤버스 자동 구독)</li>
          <li><Link href="/test-data/point" className="text-kurly-500 underline">각 회원에게 적립금 지급</Link> (주문 결제용)</li>
          <li>필요 시 <Link href="/test-data/vip" className="text-kurly-500 underline">VIP/VVIP 세팅</Link> · <Link href="/test-data/coupon" className="text-kurly-500 underline">쿠폰 발행</Link></li>
          <li><Link href="/test-data/order" className="text-kurly-500 underline">주문 생성</Link>(회원번호로) 또는 <Link href="/test-data/mixed-order" className="text-kurly-500 underline">혼합 주문</Link>으로 1P+3P 한 번에</li>
        </ol>
        <p className="mt-2 text-xs text-neutral-500">→ 5~10분 안에 "주문 완료된 회원 N명" 셋업 완료. UI 자동화 대비 100배 빠름.</p>
      </Card>

      <Card>
        <h2 className="text-base font-semibold">❓ 자주 묻는 질문</h2>
        <div className="mt-4 space-y-3 text-sm">
          <Faq q="주문할 때 컬리몰 쿠키(ksi/kdi/krt)는 어디서 넣나요?">
            이제 <strong>안 넣습니다.</strong> 주문은 내부 게이트웨이가 <Code>X-KURLY-MEMBER-NO</Code> 헤더(회원번호)만으로 인증해요. 쿠키 복사·리캡차 로그인 전부 제거됐습니다.
          </Faq>
          <Faq q="주문에서 3P도 되나요? (예전엔 1P 권장이었는데)">
            네, <strong>3P 됩니다.</strong> 3P는 전시 후 goods 페이지에서 실 dealProductNo로 자동 변환(최대 ~84초 폴링)하고, 배송완료까지 자동 처리 옵션도 있어요. 변환이 지연되면 잠시 후 재실행하면 됩니다.
          </Faq>
          <Faq q="VIP/VVIP 세팅은 어떻게 동작하나요?">
            <Code>kurlydotcom.mk_member_vip</Code> 테이블에 <strong>DB 직접 UPSERT</strong>(회원번호 기준 있으면 갱신/없으면 추가). API가 아니라 DB라 인증 없이 즉시 반영됩니다.
          </Faq>
          <Faq q="혼합 주문에서 배송완료 체크가 비활성화돼요">
            발송처리가 <strong>일반(택배) 배치</strong>라, 3P에 컬리배송 등 다른 유형이 섞이면 자동으로 꺼집니다. 3P를 전부 일반(택배)으로 하면 활성화돼요.
          </Faq>
          <Faq q="lacms 이메일/패스워드는 안전한가요?">
            패스워드는 <strong>브라우저에 저장 안 되고</strong>, 서버에서 OAuth 토큰을 즉시 받은 뒤 폐기. 이메일만 다음 사용 편의로 localStorage 저장.
          </Faq>
          <Faq q="적립금 지급 API가 production에도 영향 있나요?">
            ❌ <strong>stg test 전용 endpoint</strong>(<Code>point.stg.kurlypay.services</Code>). production 영향 없습니다.
          </Faq>
          <Faq q="할인/쿠폰에서 X-KURLY-CMS-USER 입력란이 안 보여요">
            보통 JWT 클레임에서 자동 생성(<Code>mno:email:name</Code> base64)돼서 불필요. 401이 뜰 때만 lacms 네트워크탭에서 복사해 수동 입력하면 됩니다.
          </Faq>
        </div>
      </Card>

      <Card>
        <p className="text-xs text-neutral-500">
          → <Link href="/guide" className="text-kurly-500 underline">가이드 목록</Link>으로 돌아가기 ·
          {" "}<Link href="/test-data" className="text-kurly-500 underline">테스트 데이터 메뉴 바로 가기</Link>
        </p>
      </Card>
    </GuideShell>
  );
}
