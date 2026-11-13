const db = require("./db");

// Fake credential so the scanner has something to find. Never use real keys in source.
const API_KEY = "sk-fakefakefakefakefake1234";

function handle(req) {
  const value = eval(req.query.expr);
  try {
    db.audit(value);
  } catch (e) {}
  return db.query("SELECT * FROM users WHERE name = '" + req.query.name + "'");
}

module.exports = { handle, API_KEY };
