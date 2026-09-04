/**
 * The application's only icon set.
 *
 * One drawing style throughout: a 24-unit grid, 1.75 stroke, round caps, no
 * fills. Mixing icon families is one of the fastest ways to make an interface
 * look assembled rather than designed, so anything new belongs in this file
 * drawn to the same rules — never pulled in from elsewhere and never an emoji.
 *
 * Size defaults to 16px, which is the size that sits correctly next to 13px
 * body text and inside a 30px small button.
 */
import type { SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Edge length in pixels. 16 for inline and buttons, 20 for headers, 24+ for empty states. */
  size?: number;
}

function Icon({ size = 16, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      {...props}
    >
      {children}
    </svg>
  );
}

/* ---- Navigation ---------------------------------------------------------- */

export const IconOverview = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 13h6v7H4zM4 4h6v5H4zM14 4h6v7h-6zM14 15h6v5h-6z" />
  </Icon>
);

export const IconPlug = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6zM12 17v4" />
  </Icon>
);

export const IconStandards = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5zM9 4h9.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H9M12.5 9h4M12.5 12.5h4" />
  </Icon>
);

export const IconCatalog = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5zM13.5 3v5.5H19M8.5 13h7M8.5 16.5h4.5" />
  </Icon>
);

export const IconMappings = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 14.5 14.5 9.5M7.8 11.2 6 13a3.5 3.5 0 0 0 5 5l1.8-1.8M16.2 12.8 18 11a3.5 3.5 0 0 0-5-5l-1.8 1.8" />
  </Icon>
);

export const IconExport = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3v11M8 10.5l4 3.5 4-3.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Icon>
);

export const IconShield = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3l7 3v5.5c0 4.3-2.9 7.7-7 9.5-4.1-1.8-7-5.2-7-9.5V6zM9.5 12l1.8 1.8 3.4-3.6" />
  </Icon>
);

/* ---- Status -------------------------------------------------------------- */

export const IconCheck = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 12.5 9 17 19.5 6.5" />
  </Icon>
);

export const IconCheckCircle = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 12.2l2.4 2.3 4.6-4.9" />
  </Icon>
);

export const IconWarning = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4.5 21 19.5H3zM12 10v4M12 16.8v.2" />
  </Icon>
);

export const IconError = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4.5M12 15.8v.2" />
  </Icon>
);

export const IconInfo = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11.5V16M12 8.2v.2" />
  </Icon>
);

/* ---- Actions ------------------------------------------------------------- */

export const IconClose = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const IconSearch = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.4 15.4 4.1 4.1" />
  </Icon>
);

export const IconRefresh = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4.5V10h-5.4" />
  </Icon>
);

export const IconTrash = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2A1.8 1.8 0 0 0 9.2 21h5.6a1.8 1.8 0 0 0 1.8-1.8L17.5 7M10.5 11v6M13.5 11v6" />
  </Icon>
);

export const IconEdit = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 19.5h4L20 8a2.1 2.1 0 0 0-3-3L5.5 16.5zM15.5 6.5l3 3" />
  </Icon>
);

export const IconUpload = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 16V5M8 8.5 12 5l4 3.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Icon>
);

export const IconDownload = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4v11M8 11.5l4 3.5 4-3.5M4 18h16" />
  </Icon>
);

export const IconExternal = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14 4.5h5.5V10M19 5l-7.5 7.5M17 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7H10" />
  </Icon>
);

export const IconLink = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10.5 7H8a5 5 0 0 0 0 10h2.5M13.5 7H16a5 5 0 0 1 0 10h-2.5M8.5 12h7" />
  </Icon>
);

export const IconChevronLeft = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Icon>
);

export const IconChevronRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Icon>
);

export const IconMenu = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconLogout = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.5 8V5.5A1.5 1.5 0 0 0 13 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H13a1.5 1.5 0 0 0 1.5-1.5V16M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
  </Icon>
);

/* ---- Domain -------------------------------------------------------------- */

export const IconDatabase = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx="12" cy="6" rx="7" ry="2.8" />
    <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
  </Icon>
);

export const IconMonitor = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="4.5" width="18" height="12" rx="1.8" />
    <path d="M9 20h6M12 16.5V20" />
  </Icon>
);

export const IconPill = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.6" y="8.4" width="18.8" height="7.2" rx="3.6" transform="rotate(-45 12 12)" />
    <path d="M9.5 9.5 14.5 14.5" />
  </Icon>
);

export const IconInbox = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 13.5 6 5.2A1.6 1.6 0 0 1 7.5 4h9a1.6 1.6 0 0 1 1.5 1.2l2.5 8.3M3.5 13.5v4.9A1.6 1.6 0 0 0 5.1 20h13.8a1.6 1.6 0 0 0 1.6-1.6v-4.9M3.5 13.5h4.2l1.1 2.4h6.4l1.1-2.4h4.2" />
  </Icon>
);

/** Only ever rendered with the `animate-spin` class alongside it. */
export const IconSpinner = ({ size = 16, ...props }: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.25}
    strokeLinecap="round"
    aria-hidden
    focusable={false}
    {...props}
  >
    <circle cx="12" cy="12" r="8.5" opacity={0.28} />
    <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" />
  </svg>
);
