const bcrypt = require("bcrypt");
const supabase = require("../config/supabaseClient");
const jwt = require("jsonwebtoken");

const registerUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "Email, Password, and Username are required" });
  }

  try {
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existingUser) {
      return res
        .status(400)
        .json({ error: "This email is already registered" });
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const userId = data.user?.id;
    if (!userId) {
      return res.status(500).json({ error: "Failed to retrieve user ID" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { error: insertError } = await supabase.from("users").insert([
      {
        id: userId,
        email,
        password: hashedPassword,
        avatar_url: "",
        user_name: "",
      },
    ]);

    if (insertError) {
      console.error("Supabase Insert Error:", insertError.message);
      return res.status(500).json({ error: "Failed to add user to database" });
    }

    res
      .status(201)
      .json({ message: "User registered successfully", user: data.user });
  } catch (err) {
    console.error("Register Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and Password are required" });
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    return res.status(200).json({ message: "Login successful", token });
  } catch (err) {
    console.error("Login error:", err.message || err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = { registerUser, loginUser };
