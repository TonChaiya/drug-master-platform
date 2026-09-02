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
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_.9fr]">
      {/* The PHP system's split sign-in: editorial panel left, form right. */}
      <section aria-hidden className="relative hidden overflow-hidden bg-slate-900 px-[8vw] py-16 text-white lg:flex lg:flex-col lg:justify-center">
        <span className="absolute left-12 top-10 grid size-13 place-items-center rounded-md bg-brand-600 font-display text-sm font-extrabold">TM</span>
        <span className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-brand-600/90" />
        <span className="pointer-events-none absolute -bottom-32 left-24 size-80 rounded-full bg-white/5" />
        <p className="eyebrow relative z-10 text-white/60">Thai Medicines Terminology</p>
        <h1 className="relative z-10 mt-4 font-display text-6xl font-extrabold leading-[0.92] tracking-[-0.06em] xl:text-7xl">
          จับคู่ข้อมูลยา
          <br />
          <span className="text-brand-600">อย่างมีมาตรฐาน.</span>
        </h1>
        <p className="relative z-10 mt-7 max-w-lg text-sm text-white/70">
          ดึงยาที่ใช้งานจาก JHCIS ตรวจเทียบ Drug Catalog ค้นหา TMT/TTMT และส่งออกในฟอร์มเดิม พร้อมร่องรอยตรวจสอบทุกขั้นตอน
        </p>
        <p className="relative z-10 mt-10 border-t border-white/15 pt-4">
          <strong className="block font-display text-2xl font-extrabold">01 / 10</strong>
          <span className="text-xxs text-white/50">Drug types in scope</span>
        </p>
      </section>

      <section className="grid place-items-center px-3 py-10">
        <div className="card w-full max-w-md p-6">
        <p className="eyebrow text-brand-600">Secure workspace</p>
        <h1 className="page-title mt-1.5">{mode === "login" ? "ยินดีต้อนรับ" : "สมัครสมาชิก"}</h1>
        <p className="mt-1 text-xxs text-slate-500">
          {mode === "login" ? "เข้าสู่ระบบเพื่อเริ่มจัดการข้อมูล TMT" : "สมัครเพื่อขอสิทธิ์ใช้งานของสถานบริการ"}
        </p>

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
            <label className="label" htmlFor="password">{mode === "signup" ? "รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)" : "รหัสผ่าน"}</label>
            <input
              className="field"
              id="password"
              name="password"
              type="password"
              required
              minLength={mode === "signup" ? 6 : undefined}
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
        </div>
      </section>
    </main>
  );
}
