export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: "admin" | "user";
  facilityId: string | null;
  facilityCode: string | null;
  facilityName: string | null;
  mustChangePassword: boolean;
}
