const NSE_BASE_URL = 'https://www.nseindia.com';

async function fetchNSEWithAggressiveHeaders() {
  try {
    // Step 1: Prime the session with homepage
    console.log('[1/3] Priming session with homepage...');
    const homeRes = await fetch(NSE_BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });

    const cookies = [];
    const setCookieHeader = homeRes.headers.get('set-cookie');
    if (setCookieHeader) {
      setCookieHeader.split(/,(?=\s*[^=]+=)/).forEach(cookie => {
        const parts = cookie.split(';');
        if (parts[0].trim()) cookies.push(parts[0].trim());
      });
    }
    
    console.log(`   Got ${cookies.length} cookies`);

    // Step 2: Try fetching option chain with all cookies
    console.log('[2/3] Fetching option chain...');
    const apiUrl = `${NSE_BASE_URL}/api/option-chain-indices?symbol=NIFTY`;
    const apiRes = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8',
        'Referer': `${NSE_BASE_URL}/option-chain`,
        'Origin': NSE_BASE_URL,
        'Sec-Fetch-Dest': 'fetch',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...(cookies.length > 0 && { 'Cookie': cookies.join('; ') }),
      },
    });

    console.log(`   Status: ${apiRes.status}`);
    const data = await apiRes.json();
    console.log(`   Response type: ${typeof data}`);
    console.log(`   Response keys: ${Object.keys(data || {}).join(', ')}`);

    if (data && data.records && data.records.data) {
      console.log(`   Records count: ${data.records.data.length}`);
      
      // Find 24850 strike
      const strike24850 = data.records.data.find(r => r.strikePrice === 24850);
      if (strike24850) {
        console.log('\n   ✓ Found 24850 strike!');
        console.log('     Call lastPrice:', strike24850.CE?.lastPrice);
        console.log('     Call OI:', strike24850.CE?.openInterest);
        console.log('     Put lastPrice:', strike24850.PE?.lastPrice);
        console.log('     Put OI:', strike24850.PE?.openInterest);
      } else {
        console.log('   ✗ Strike 24850 not found. Available strikes:');
        const strikes = data.records.data.slice(0, 5).map(r => r.strikePrice);
        console.log('     Sample:', strikes.join(', '));
      }
    } else {
      console.log('   Empty response - no records');
      console.log('   Full response:', JSON.stringify(data).slice(0, 200));
    }

  } catch (err) {
    console.error('Error:', err.message);
  }
}

fetchNSEWithAggressiveHeaders();
