export const staffMessages = {
  title: "Staff accounts",
  description: "Manage who can sign in and what they can access.",
  add: "Add staff member",
  create: "Create account",
  empty: "No staff accounts are available.",
  staffMember: "Staff member",
  role: "Role",
  status: "Status",
  lastLogin: "Last sign-in",
  neverSignedIn: "Never signed in",
  actions: "Actions",
  manage: "Manage",
  active: "Active",
  disabled: "Disabled",
  back: "Staff accounts",
  cancel: "Cancel",
  displayName: "Full name",
  username: "Username",
  email: "Email address",
  temporaryPassword: "Temporary password",
  temporaryPasswordHelp:
    "Use 15 to 128 characters. Staff choose a new password when they sign in.",
  usernameHelp: "Use 3 to 64 characters. Start with a letter or number.",
  createDescription: "Give a staff member their own sign-in and role.",
  accountAccess: "Account access",
  accessHelp:
    "Changing the role or status signs this person out on all devices.",
  saveAccess: "Save access",
  resetPassword: "Reset password",
  resetHelp:
    "Set a temporary password and sign this person out on all devices. Their two-factor settings stay in effect.",
  saving: "Saving…",
  roleNames: {
    OWNER: "Owner",
    ACCOUNTANT: "Accountant",
    OPERATOR: "Operator",
    VIEWER: "Viewer",
  },
  success: {
    create: "Staff account created.",
    access: "Account access saved.",
    reset: "Password reset. Share the temporary password privately.",
  },
  errors: {
    invalid: "Review the highlighted fields and try again.",
    duplicate:
      "Use a different username or email address. One is already assigned.",
    missing: "This staff account could not be found.",
    lastOwner:
      "Keep at least one active Owner. Assign a second Owner before changing this account.",
    save: "The account could not be saved. Try again.",
  },
} as const;
