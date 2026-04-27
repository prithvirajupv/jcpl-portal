const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby738DpEnkmnQE08MjoTi3lV8-5jlT9IzcJvTR2Rq0kRPwnJl2qq3btfK_cdGBcEnFN/exec';

export default async (req, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const params = url.searchParams.toString();
    const targetUrl = APPS_SCRIPT_URL + (params ? '?' + params : '');
    
    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'JCPL-Portal/1.0' }
    });

    const text = await response.text();
    return new Response(text, { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: corsHeaders
    });
  }
};

export const config = { path: '/api' };
