async function testProdADK() {
  const ADK_URL = "http://localhost:8000";
  
  // 1. Create session
  const sessionRes = await fetch(`${ADK_URL}/apps/agent/users/test_user/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  
  const sessionData = await sessionRes.json();
  const sessionId = sessionData.id || sessionData.session_id;
  console.log("Created session:", sessionId);

  // 2. Send message
  const payload = {
    appName: "agent",
    userId: "test_user",
    sessionId: sessionId,
    newMessage: {
      role: 'user',
      parts: [{ text: "hello" }],
    },
  };

  const runRes = await fetch(`${ADK_URL}/apps/agent/users/test_user/sessions/${sessionId}/run_sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const text = await runRes.text();
  console.log("Prod ADK Response:");
  console.log(text);
}

testProdADK();
