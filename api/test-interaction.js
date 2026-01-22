export default async function handler(req, res) {
  console.log('🔍 Test interaction endpoint called');
  console.log('Method:', req.method);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body type:', typeof req.body);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  
  if (req.method === 'POST') {
    // Try to parse Slack payload
    try {
      let payload;
      
      if (typeof req.body === 'string') {
        const params = new URLSearchParams(req.body);
        payload = JSON.parse(params.get('payload'));
      } else if (req.body.payload) {
        payload = typeof req.body.payload === 'string' ? JSON.parse(req.body.payload) : req.body.payload;
      }
      
      console.log('Parsed payload:', JSON.stringify(payload, null, 2));
      
      return res.status(200).json({
        success: true,
        message: 'Test endpoint working',
        receivedPayload: payload,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Error parsing payload:', error);
      return res.status(400).json({
        success: false,
        error: error.message,
        rawBody: req.body
      });
    }
  }
  
  res.status(200).json({
    message: 'Test endpoint is working',
    method: req.method,
    timestamp: new Date().toISOString()
  });
}