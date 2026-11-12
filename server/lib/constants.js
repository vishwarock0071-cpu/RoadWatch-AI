// Shared vocabulary used by the API, the seed script and validation.
const ROLES = ["Administrator", "Municipal Officer", "Repair Team", "Read-Only Auditor"];
const TYPES = [
  "Pothole", "Longitudinal crack", "Transverse crack", "Alligator cracking", "Road-edge damage",
  "Damaged manhole cover", "Damaged speed breaker", "Failed patch", "Utility road cut", "Loose debris",
  "Waterlogging-related damage",
];
const SEVERITIES = ["Critical", "High", "Medium", "Low"];
const STATUSES = [
  "Reported", "Under Review", "Confirmed", "Assigned", "In Repair",
  "Awaiting Verification", "Resolved", "Needs Rework", "Rejected",
];
const CLOSED_STATUSES = ["Resolved", "Rejected"];
const SOURCES = ["Government bus", "Garbage collection", "Citizen report", "Field officer"];
const PERMIT_STATUSES = ["Found", "Not found in records", "Pending verification", "Not applicable"];

// Repair deadline (days from case creation) by severity.
const SLA_DAYS = { Critical: 2, High: 7, Medium: 14, Low: 30 };

// Which roles may move a case into which status.
const STATUS_RULES = {
  Administrator: STATUSES,
  "Municipal Officer": STATUSES,
  "Repair Team": ["In Repair", "Awaiting Verification"],
  "Read-Only Auditor": [],
};

const ROLE_CAN = {
  createCase: ["Administrator", "Municipal Officer"],
  editCase: ["Administrator", "Municipal Officer"],
  repairUpdate: ["Administrator", "Municipal Officer", "Repair Team"],
  manageTeams: ["Administrator", "Municipal Officer"],
  manageVehicles: ["Administrator", "Municipal Officer"],
  manageUsers: ["Administrator"],
  exportReports: ["Administrator", "Municipal Officer", "Read-Only Auditor"],
};

module.exports = {
  ROLES, TYPES, SEVERITIES, STATUSES, CLOSED_STATUSES, SOURCES, PERMIT_STATUSES,
  SLA_DAYS, STATUS_RULES, ROLE_CAN,
};
