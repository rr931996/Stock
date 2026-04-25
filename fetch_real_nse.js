const NSE_BASE_URL = 'https://www.nseindia.com';

async function fetchNSEOptionChain() {
  try {
    // Step 1: Prime the session with a homepage visit
    const homeRes = await fetch(NSE_BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    const setCookieHeader = homeRes.headers.get('set-cookie') || '';
    const sessionCookie = setCookieHeader.split(';')[0];
    
    console.log('Session cookie:', sessionCookie ? 'OK' : 'NONE');

    // Step 2: Try API endpoint with proper Cookie
    const apiUrl = `${NSE_BASE_URL}/api/option-chain-indices?symbol=NIFTY`;
    const apiRes = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'DNT': '1',
        'Referer': 'https://www.nseindia.com/option-chain',
        'Origin': 'https://www.nseindia.com',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Connection': 'keep-alive',
        'Cache-Control': 'max-age=0',
        ...(sessionCookie ? { 'Cookie': sessionCookie } : {}),
      },
      redirect: 'follow',
    });

    console.log('API status:', apiRes.status);
    console.log('API content-type:', apiRes.headers.get('content-type'));

    const data = await apiRes.json();
    console.log('Response keys:', Object.keys(data));
    console.log('Records count:', data.records?.data?.length || 0);

    // Check if we have call/put data for 24850 strike
    if (data.records?.data && Array.isArray(data.records.data)) {
      const strike24850 = data.records.data.find(r => r.strikePrice === 24850);
      if (strike24850) {
        console.log('\nStrike 24850 data:');
        console.log('CALL:', strike24850.CE);
        console.log('PUT:', strike24850.PE);
      }
    }

    return data;
  } catch (err) {
    console.error('Error:', err.message);
  }
}

fetchNSEOptionChain();
