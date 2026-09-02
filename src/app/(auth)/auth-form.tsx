"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Mode = "login" | "signup";

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage(null);
    setOk(false);
    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      const response = await fetch(`/api/v1/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !result.ok) {
        setMessage(result.message ?? "ดำเนินการไม่สำเร็จ");
        return;
      }
      if (mode === "login") {
        router.push("/dashboard");
        router.refresh();
      } else {
        setOk(true);
        setMessage(result.message ?? "สมัครสมาชิกสำเร็จ กรุณาติดต่อผู้พัฒนาเพื่ออนุมัติไอดี");
        form.reset();
      }
    } catch {
      setMessage("ติดต่อระบบไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-3 py-8">
      <section className="card w-full max-w-md p-5">
        <div className="grid size-9 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">Rx</div>
        <h1 className="mt-3 text-lg font-semibold">{mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}</h1>
        <p className="text-xxs text-slate-500">TMT Drug Master Platform</p>

        <form onSubmit={submit} className="mt-4 space-y-2.5">
          {mode === "signup" ? (
            <>
              <div>
                <label className="label" htmlFor="fullName">ชื่อ-สกุล</label>
                <input className="field" id="fullName" name="fullName" required minLength={2} maxLength={255} autoComplete="name" />
              </div>
              <div>
                <label className="label" htmlFor="positionName">ตำแหน่ง</label>
                <input className="field" id="positionName" name="positionName" required minLength={2} maxLength={160} />
              </div>
              <div className="grid gap-2.5 sm:grid-cols-[8rem_1fr]">
                <div>
                  <label className="label" htmlFor="facilityCode">รหัสสถานบริการ</label>
                  <input className="field font-mono" id="facilityCode" name="facilityCode" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} />
                </div>
                <div>
                  <label className="label" htmlFor="facilityName">ชื่อสถานบริการ</label>
                  <input className="field" id="facilityName" name="facilityName" required minLength={2} maxLength={255} />
                </div>
              </div>
            </>
          ) : null}

          <div>
            <label className="label" htmlFor="username">User ID</label>
            <input className="field" id="username" name="username" required minLength={4} maxLength={80} autoComplete="username" />
          </div>
          <div>
            <label className="label" htmlFor="password">รหัสผ่าน (อย่างน้อย 12 ตัวอักษร)</label>
            <input
              className="field"
              id="password"
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {message ? (
            <p className={`rounded-md px-2.5 py-2 text-xxs ${ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`} role="alert">
              {message}
            </p>
          ) : null}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? "กำลังดำเนินการ…" : mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
          </button>
        </form>

        <p className="mt-3 text-center text-xxs text-slate-500">
          {mode === "login" ? (
            <>
              ยังไม่มีบัญชี? <Link className="text-brand-700 underline" href="/signup">สมัครสมาชิก</Link>
            </>
          ) : (
            <>
              มีบัญชีแล้ว? <Link className="text-brand-700 underline" href="/login">เข้าสู่ระบบ</Link>
            </>
          )}
        </p>
      </section>
    </main>
  );
}
