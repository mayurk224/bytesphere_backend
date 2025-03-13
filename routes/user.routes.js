const express = require("express");
const router = express.Router();
const authenticateUser = require("../middlewares/auth.middleware");

router.get("/user-details", authenticateUser, async (req, res) => {
  try {
    res.json({ user: req.user });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});

module.exports = router;
