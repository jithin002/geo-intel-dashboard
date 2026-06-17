

async function testADK() {
  const payload = {
    message: "i want to open a restaurant in indiranagar",
    userId: "test_user"
  };

  try {
    const res = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Raw Response:");
    console.log(text);
  } catch (err) {
    console.error("Error:", err.message);
  }
}

testADK();
