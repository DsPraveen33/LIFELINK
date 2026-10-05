import { io } from "socket.io-client";

const BASE_URL = process.env.TEST_API_URL || "http://localhost:5005/api";
const SOCKET_URL = process.env.TEST_SOCKET_URL || "http://localhost:5005";

interface LoginResult {
  id: number;
  name: string;
  email: string;
  role: string;
  token: string;
}

async function loginAs(email: string): Promise<LoginResult> {
  const res = await fetch(`${BASE_URL}/auth/demo-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    throw new Error(`Failed to login as ${email}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function authHeader(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${testName}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✗\x1b[0m ${testName}${detail ? ` (${detail})` : ""}`);
    failed++;
  }
}

export async function runSecurityTests() {
  console.log("\n=======================================================");
  console.log("   LIFELINK FULL-STACK SECURITY & PERMISSION TEST SUITE");
  console.log("=======================================================\n");

  // Log in as test accounts
  const user1 = await loginAs("patient@lifelink.demo");
  const driver1 = await loginAs("driver@lifelink.demo");
  const driver2 = await loginAs("driver2@lifelink.demo");
  const operator = await loginAs("operator@lifelink.demo");
  const admin = await loginAs("admin@lifelink.demo");

  // 1. Normal user registration cannot create OPERATOR or ADMIN (Section 8)
  const regEmail = `test_hacker_${Date.now()}@test.com`;
  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Malicious User",
      email: regEmail,
      password: "HackerPassword123!",
      role: "ADMIN", // Attempt privilege escalation
    }),
  });
  const regData = await regRes.json();
  assert(
    regRes.status === 201 && regData.role === "USER",
    "Normal user cannot register as ADMIN (role forced to USER)",
    `Received role: ${regData.role}`,
  );

  // 2. User cannot access Command Center APIs (Section 2 & 4)
  const ccRes = await fetch(`${BASE_URL}/dashboard/summary`, {
    headers: authHeader(user1.token),
  });
  assert(
    ccRes.status === 403,
    "User cannot access command center summary API (returns 403)",
    `Status: ${ccRes.status}`,
  );

  // 3. Driver cannot access Admin Panel APIs (Section 3 & 5)
  const adminRes = await fetch(`${BASE_URL}/admin/audit-logs`, {
    headers: authHeader(driver1.token),
  });
  assert(
    adminRes.status === 403,
    "Driver cannot access admin audit logs (returns 403)",
    `Status: ${adminRes.status}`,
  );

  // 4. User creates emergency E1
  const createEmRes = await fetch(`${BASE_URL}/emergencies`, {
    method: "POST",
    headers: authHeader(user1.token),
    body: JSON.stringify({
      patientName: "Asha Verma",
      emergencyType: "CARDIAC_ARREST",
      severity: "CRITICAL",
      latitude: 13.639,
      longitude: 79.4035,
      locationLabel: "Alipiri Transit, Tirupati",
      requiredCapabilities: ["CARDIAC"],
    }),
  });
  const user1Emergency = await createEmRes.json();
  assert(
    createEmRes.status === 201 && user1Emergency.id > 0,
    "User can create own emergency",
    `Emergency ID: ${user1Emergency.id}`,
  );

  // 5. User 1 can access own emergency
  const ownEmRes = await fetch(`${BASE_URL}/emergencies/${user1Emergency.id}`, {
    headers: authHeader(user1.token),
  });
  assert(
    ownEmRes.status === 200,
    "User can view own emergency",
    `Status: ${ownEmRes.status}`,
  );

  // 6. Register a second user to test User A vs User B IDOR
  const user2Email = `user2_${Date.now()}@test.com`;
  const regUser2 = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Second Patient",
      email: user2Email,
      password: "User2Password123!",
    }),
  });
  const user2Data = await regUser2.json();

  // Login as User 2
  const user2Login = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user2Email,
      password: "User2Password123!",
    }),
  });
  const user2 = await user2Login.json();

  // 7. User 2 cannot access User 1's emergency (IDOR Protection - Section 11, 12, 31)
  const idorEmRes = await fetch(`${BASE_URL}/emergencies/${user1Emergency.id}`, {
    headers: authHeader(user2.token),
  });
  assert(
    idorEmRes.status === 403,
    "User B cannot access User A's emergency (IDOR prevented with 403)",
    `Status: ${idorEmRes.status}`,
  );

  // 8. User 2 cannot access User 1's route decision
  const idorDecisionRes = await fetch(`${BASE_URL}/emergencies/${user1Emergency.id}/decision`, {
    headers: authHeader(user2.token),
  });
  assert(
    idorDecisionRes.status === 403,
    "User B cannot access User A's route decision (returns 403)",
    `Status: ${idorDecisionRes.status}`,
  );

  // 9. Driver 1 vs Driver 2 Isolation (Section 13)
  // Driver 1 owns AMB-01 (id: 1), Driver 2 owns AMB-02 (id: 2)
  const driver2AmbRes = await fetch(`${BASE_URL}/ambulances/2/location`, {
    method: "POST",
    headers: authHeader(driver1.token),
    body: JSON.stringify({
      latitude: 13.6395,
      longitude: 79.401,
      speedKph: 45,
      heading: 90,
    }),
  });
  assert(
    driver2AmbRes.status === 403,
    "Driver A cannot update Driver B's ambulance location (returns 403)",
    `Status: ${driver2AmbRes.status}`,
  );

  // 10. Driver 1 cannot modify Driver 2's ambulance status
  const driver2StatusRes = await fetch(`${BASE_URL}/ambulances/2/status`, {
    method: "POST",
    headers: authHeader(driver1.token),
    body: JSON.stringify({ status: "ON_SCENE" }),
  });
  assert(
    driver2StatusRes.status === 403,
    "Driver A cannot change Driver B's ambulance status (returns 403)",
    `Status: ${driver2StatusRes.status}`,
  );

  // 11. Driver 1 can update own ambulance (AMB-01)
  const ownAmbRes = await fetch(`${BASE_URL}/ambulances/1/location`, {
    method: "POST",
    headers: authHeader(driver1.token),
    body: JSON.stringify({
      latitude: 13.629,
      longitude: 79.419,
      speedKph: 35,
      heading: 45,
    }),
  });
  assert(
    ownAmbRes.status === 200,
    "Driver A can update own ambulance location",
    `Status: ${ownAmbRes.status}`,
  );

  // 12. Normal user cannot view unassigned ambulance (Section 2, 20)
  const userAmbRes = await fetch(`${BASE_URL}/ambulances/5`, {
    headers: authHeader(user2.token),
  });
  assert(
    userAmbRes.status === 403,
    "User cannot view arbitrary ambulance information (returns 403)",
    `Status: ${userAmbRes.status}`,
  );

  // 13. User and Driver cannot modify hospital capacity/status (Section 2, 3, 22)
  const userHospModRes = await fetch(`${BASE_URL}/hospitals/1/status`, {
    method: "POST",
    headers: authHeader(user1.token),
    body: JSON.stringify({ readinessStatus: "FULL", emergencyStatus: "DIVERTING" }),
  });
  assert(
    userHospModRes.status === 403,
    "User cannot modify hospital capacity/status (returns 403)",
    `Status: ${userHospModRes.status}`,
  );

  const driverHospModRes = await fetch(`${BASE_URL}/hospitals/1/status`, {
    method: "POST",
    headers: authHeader(driver1.token),
    body: JSON.stringify({ readinessStatus: "FULL", emergencyStatus: "DIVERTING" }),
  });
  assert(
    driverHospModRes.status === 403,
    "Driver cannot modify hospital capacity/status (returns 403)",
    `Status: ${driverHospModRes.status}`,
  );

  // 14. Operator can update hospital readiness status (Section 4)
  const operatorHospRes = await fetch(`${BASE_URL}/hospitals/1/status`, {
    method: "POST",
    headers: authHeader(operator.token),
    body: JSON.stringify({
      readinessStatus: "READY",
      emergencyStatus: "ACCEPTING",
      traumaBeds: 6,
      icuBeds: 4,
      ventilators: 3,
      waitMinutes: 5,
    }),
  });
  assert(
    operatorHospRes.status === 200,
    "Operator can update operational hospital readiness status",
    `Status: ${operatorHospRes.status}`,
  );

  // 15. Operator/API never returns password hashes (Section 6, 23)
  const usersListRes = await fetch(`${BASE_URL}/admin/users`, {
    headers: authHeader(admin.token),
  });
  const usersList = await usersListRes.json();
  const hasPasswordHash = usersList.some((u: Record<string, unknown>) => "passwordHash" in u || "password_hash" in u);
  assert(
    !hasPasswordHash,
    "API never exposes password hashes to clients",
    `Checked ${usersList.length} users`,
  );

  // 16. Location permission grant/revoke audit logging (Section 15, 18, 27)
  const locPermRes = await fetch(`${BASE_URL}/users/me/location-permission`, {
    method: "POST",
    headers: authHeader(user1.token),
    body: JSON.stringify({ granted: true, mode: "LIVE GPS" }),
  });
  assert(
    locPermRes.status === 200,
    "User can grant location permission explicitly",
    `Status: ${locPermRes.status}`,
  );

  // 17. Invalid/expired token fails with 401 (Section 9, 32)
  const invalidTokenRes = await fetch(`${BASE_URL}/auth/me`, {
    headers: { Authorization: "Bearer invalid_fake_token_xyz" },
  });
  assert(
    invalidTokenRes.status === 401,
    "Invalid token is rejected with 401 Unauthorized",
    `Status: ${invalidTokenRes.status}`,
  );

  // 18. Audit logs recorded security events (Section 27)
  const auditRes = await fetch(`${BASE_URL}/admin/audit-logs`, {
    headers: authHeader(admin.token),
  });
  const logs = await auditRes.json();
  const hasPermissionDenied = logs.some((l: Record<string, unknown>) => l.action === "PERMISSION_DENIED");
  const hasLogin = logs.some((l: Record<string, unknown>) => l.action === "LOGIN");
  assert(
    hasPermissionDenied && hasLogin,
    "Audit logs table records LOGIN and PERMISSION_DENIED events",
    `Total audit logs: ${logs.length}`,
  );

  // 19. WebSocket Room Authorization (Section 26)
  await new Promise<void>((resolve) => {
    const socket = io(SOCKET_URL, {
      path: "/api/socket.io",
      auth: { token: user2.token },
      reconnection: false,
      timeout: 3000,
    });

    socket.on("connect", () => {
      // User 2 attempts to join User 1's emergency room
      socket.emit("emergency:join", { emergencyId: user1Emergency.id });
    });

    socket.on("error", (err: { message: string }) => {
      assert(
        err.message.includes("permission"),
        "Unauthorized WebSocket emergency room join rejected",
        err.message,
      );
      socket.disconnect();
      resolve();
    });

    socket.on("emergency:joined", () => {
      assert(false, "Unauthorized WebSocket room join should NOT succeed");
      socket.disconnect();
      resolve();
    });

    setTimeout(() => {
      socket.disconnect();
      resolve();
    }, 2500);
  });

  console.log("\n=======================================================");
  console.log(`   RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("=======================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

void runSecurityTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
