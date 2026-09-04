"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/badge";
import { Field, TextInput } from "@/components/ui/form";
import { IconCheckCircle, IconDatabase, IconExport, IconMappings } from "@/components/ui/icons";

type Mode = "login" | "signup";

/** What the system does, stated once, on the only page a stranger ever sees. */
const CAPABILITIES = [
  { icon: <IconDatabase size={15} />, text: "ดึงรายการยาที่เปิดใช้งานจาก JHCIS ของแต่ละสถานบริการ" },
  { icon: <IconMappings size={15} />, text: "จับคู่กับรหัสมาตรฐาน TMT และ TTMT ทีละรายการหรืออัตโนมัติ" },
  { icon: <IconExport size={15} />, text: "ส่งออกไฟล์ DrugCat ตามฟอร์ม 22 คอลัมน์ พร้อมร่องรอยตรวจสอบ" },
];

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [facilityName, setFacilityName] = useState("");
  const [facilityNote, setFacilityNote] = useState<string | null>(null);

  /**
   * Several accounts share one facility, so the second person to sign up has to
   * name a facility that already exists. Asking them to reproduce its name
   * exactly is a trap; the code is the identifier, so look the name up from it.
   */
  async function lookupFacility(code: string) {
    if (!/^\d{5}$/.test(code)) {
      setFacilityNote(null);
      return;
    }
    const response = await fetch(`/api/v1/facilities/lookup?code=${code}`);
    const result = (await response.json()) as { registered?: boolean; facilityName?: string; active?: boolean };
    if (!response.ok || !result.registered || !result.facilityName) {
      setFacilityNote("รหัสนี้ยังไม่มีในระบบ — บัญชีแรกของสถานบริการนี้ กรุณากรอกชื่อให้ถูกต้อง");
      return;
    }
    setFacilityName(result.facilityName);
    setFacilityNote(
      result.active
        ? `พบสถานบริการนี้แล้ว บัญชีของท่านจะใช้ข้อมูลร่วมกับไอดีอื่นของ ${result.facilityName}`
        : `สถานบริการ ${result.facilityName} ถูกปิดใช้งานอยู่ กรุณาติดต่อผู้ดูแลระบบ`,
    );
  }

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
    <main className="grid min-h-dvh lg:grid-cols-[1fr_28rem] xl:grid-cols-[1fr_32rem]">
      {/* Editorial panel left, form right. Decorative, so it is hidden from
          assistive technology and from anything narrower than a laptop. */}
      <section aria-hidden className="relative hidden overflow-hidden bg-slate-900 px-[7vw] py-16 text-white lg:flex lg:flex-col lg:justify-center">
        <span className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-primary-600/25 blur-3xl" />
        <span className="pointer-events-none absolute -bottom-40 -left-20 size-96 rounded-full bg-primary-500/10 blur-3xl" />

        <div className="absolute left-[7vw] top-12 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-primary-600 font-display text-xxs font-extrabold">TM</span>
          <span className="font-display text-sm font-bold tracking-tight">Drug Master</span>
        </div>

        <p className="eyebrow relative z-10 text-white/50">Thai Medicines Terminology</p>
        <h2 className="relative z-10 mt-4 max-w-xl font-display text-5xl font-extrabold leading-[1.05] tracking-[-0.04em] xl:text-6xl">
          บัญชียาของสถานบริการ
          <br />
          <span className="text-primary-300">ให้ตรงมาตรฐาน</span>
        </h2>

        <ul className="relative z-10 mt-9 max-w-lg space-y-3">
          {CAPABILITIES.map((item) => (
            <li key={item.text} className="flex items-start gap-2.5">
              <span className="mt-px grid size-6 shrink-0 place-items-center rounded-md bg-white/10 text-primary-300">{item.icon}</span>
              <span className="text-sm leading-relaxed text-white/70">{item.text}</span>
            </li>
          ))}
        </ul>

        <p className="relative z-10 mt-10 max-w-lg border-t border-white/10 pt-4 text-xxs text-white/40">
          รหัสฐานข้อมูล JHCIS อยู่ที่เครื่องในสถานบริการเท่านั้น ไม่ถูกส่งขึ้นระบบกลาง
        </p>
      </section>

      <section className="grid place-items-center px-4 py-10">
        <div className="w-full max-w-sm">
          {/* The mark repeats here because the left panel is hidden on mobile. */}
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span
              aria-hidden
              className="grid size-9 place-items-center rounded-lg bg-primary-600 font-display text-xxs font-extrabold text-white"
            >
              TM
            </span>
            <span className="font-display text-sm font-bold tracking-tight text-slate-900">Drug Master</span>
          </div>

          <h1 className="type-page-title">{mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}</h1>
          <p className="type-help mt-1.5">
            {mode === "login" ? "ใช้ไอดีของสถานบริการที่ได้รับอนุมัติแล้ว" : "สมัครเพื่อขอสิทธิ์ใช้งานของสถานบริการ"}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            {mode === "signup" ? (
              <>
                <Field label="ชื่อ-สกุล" htmlFor="fullName" required>
                  <TextInput id="fullName" name="fullName" required minLength={2} maxLength={255} autoComplete="name" />
                </Field>
                <Field label="ตำแหน่ง" htmlFor="positionName" required>
                  <TextInput id="positionName" name="positionName" required minLength={2} maxLength={160} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                  <Field label="รหัสสถานบริการ" htmlFor="facilityCode" required>
                    <TextInput
                      id="facilityCode"
                      name="facilityCode"
                      mono
                      required
                      inputMode="numeric"
                      pattern="[0-9]{5}"
                      maxLength={5}
                      onBlur={(event) => void lookupFacility(event.target.value.trim())}
                    />
                  </Field>
                  <Field label="ชื่อสถานบริการ" htmlFor="facilityName" required>
                    <TextInput
                      id="facilityName"
                      name="facilityName"
                      required
                      minLength={2}
                      maxLength={255}
                      value={facilityName}
                      onChange={(event) => setFacilityName(event.target.value)}
                    />
                  </Field>
                </div>
                {facilityNote ? (
                  <Alert tone="info">{facilityNote}</Alert>
                ) : null}
              </>
            ) : null}

            <Field label="User ID" htmlFor="username" required>
              <TextInput id="username" name="username" required minLength={4} maxLength={80} autoComplete="username" />
            </Field>
            <Field
              label="รหัสผ่าน"
              htmlFor="password"
              help={mode === "signup" ? "อย่างน้อย 6 ตัวอักษร" : undefined}
              required
            >
              <TextInput
                id="password"
                name="password"
                type="password"
                required
                minLength={mode === "signup" ? 6 : undefined}
                maxLength={128}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </Field>

            {message ? (
              <Alert tone={ok ? "success" : "danger"} title={ok ? "สมัครสมาชิกสำเร็จ" : undefined}>
                {message}
              </Alert>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              fullWidth
              loading={busy}
              icon={ok && mode === "signup" ? <IconCheckCircle size={15} /> : undefined}
            >
              {mode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
            </Button>
          </form>

          <p className="type-help mt-5 text-center">
            {mode === "login" ? (
              <>
                ยังไม่มีบัญชี?{" "}
                <Link className="rounded font-semibold text-primary-700 underline underline-offset-2" href="/signup">
                  สมัครสมาชิก
                </Link>
              </>
            ) : (
              <>
                มีบัญชีแล้ว?{" "}
                <Link className="rounded font-semibold text-primary-700 underline underline-offset-2" href="/login">
                  เข้าสู่ระบบ
                </Link>
              </>
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
