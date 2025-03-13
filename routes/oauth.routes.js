const express = require("express");
const jwt = require("jsonwebtoken");
const supabase = require("../config/supabaseClient");
require("dotenv").config();

const router = express.Router();

router.get("/google-url", async (req, res) => {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${process.env.FRONTEND_URL}/auth/callback`,
      },
    });

    if (error) {
      console.error("Google OAuth Error:", error.message);
      return res.status(400).json({ error: error.message });
    }

    res.json({ url: data.url });
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/google-callback", async (req, res) => {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      return res.status(400).json({ error: "Access token missing" });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(
      access_token
    );

    if (userError || !userData?.user) {
      console.error("Supabase Auth Error:", userError?.message);
      return res.status(400).json({ error: "Invalid token or user not found" });
    }

    const user = userData.user;

    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("*")
      .eq("email", user.email)
      .single();

    if (!existingUser) {
      const { error: insertError } = await supabase.from("users").insert([
        {
          id: user.id,
          email: user.email,
          user_name: user.user_metadata?.full_name || "No Name",
          avatar_url:
            user.user_metadata?.avatar_url ||
            "https://example.com/default-avatar.png",
        },
      ]);

      if (insertError) {
        console.error("Supabase Insert Error:", insertError.message);
        return res
          .status(500)
          .json({ error: "Failed to add user to database" });
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );

    res.json({ message: "Login successful", token });
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
