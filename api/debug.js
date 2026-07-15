module.exports = function handler(req, res) {
  res.status(200).json({
    TOSS_SECRET_KEY: !!process.env.TOSS_SECRET_KEY,
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY
  });
};
