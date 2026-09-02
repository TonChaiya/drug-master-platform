import { redirect } from "next/navigation";
import { AuthForm } from "../auth-form";
import { currentUser } from "@/modules/auth/session";

export default async function LoginPage() {
  if (await currentUser()) redirect("/dashboard");
  return <AuthForm mode="login" />;
}
