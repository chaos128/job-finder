-- 이 파일은 Supabase 대시보드의 SQL 에디터에서 사람이 직접 실행한다
-- (레포에 마이그레이션 러너가 없다). `if not exists`라서 여러 번 실행해도
-- 안전하다 — 이미 적용된 상태에서 다시 돌려도 아무 일도 일어나지 않는다.
--
-- 왜 필요한가: 영구 실패하는 알림(빈 notify_email, 미검증 발신 도메인 등)이
-- 하나라도 생기면 markNotificationFailed가 매번 status='pending'으로 되돌려
-- retry-first 게이트에 걸리고, 그 뒤 어떤 다이제스트도 만들어지지 않는다.
-- attempts가 상한(3)에 닿으면 status='failed'로 확정해 게이트를 푼다.

alter table notifications
  add column if not exists attempts int not null default 0;
