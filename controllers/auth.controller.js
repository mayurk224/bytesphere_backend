const bcrypt = require("bcrypt");
const supabase = require("../config/supabaseClient");
const jwt = require('jsonwebtoken');

// **Register User Controller**
const registerUser = async (req, res) => {
    const { email, password} = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email, Password, and Username are required" });
    }

    try {
        // ✅ Check if user already exists in `users` table
        const { data: existingUser, error: fetchError } = await supabase
            .from("users")
            .select("id")
            .eq("email", email)
            .single();

        if (existingUser) {
            return res.status(400).json({ error: "This email is already registered" });
        }

        // ✅ Register user in Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
        });

        if (error) {
            return res.status(400).json({ error: error.message });
        }

        // ✅ Ensure `user.id` is available
        const userId = data.user?.id;
        if (!userId) {
            return res.status(500).json({ error: "Failed to retrieve user ID" });
        }

        // ✅ Hash Password Before Storing
        const hashedPassword = await bcrypt.hash(password, 10);

        // ✅ Insert user into `users` table
        const { error: insertError } = await supabase.from("users").insert([
            {
                id: userId,
                email,
                password: hashedPassword, // Store hashed password
                avatar_url: "", // Default avatar if none provided
                user_name: "",
            }
        ]);

        if (insertError) {
            console.error("Supabase Insert Error:", insertError.message);
            return res.status(500).json({ error: "Failed to add user to database" });
        }

        res.status(201).json({ message: "User registered successfully", user: data.user });
    } catch (err) {
        console.error("Register Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};


// **Login User Controller**
const loginUser = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Email and Password are required" });
    }

    try {
        // Authenticate user with Supabase
        const { data: { user }, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error || !user) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Generate JWT Token
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: "1h" });

        return res.status(200).json({ message: "Login successful", token });
    } catch (err) {
        console.error("Login error:", err.message || err);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

module.exports = { registerUser, loginUser };
