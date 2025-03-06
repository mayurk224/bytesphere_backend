const express = require("express");
const { registerUser, loginUser } = require("../controllers/auth.controller");
const authenticateToken = require("../middlewares/auth.middleware");
const jwt = require("jsonwebtoken");
const supabase = require("../config/supabaseClient");
const multer = require("multer");


const router = express.Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/logout",authenticateToken, async (req, res) => {
    try {
        const { error } = await supabase.auth.signOut();

        if (error) {
            console.error("Logout Error:", error.message);
            return res.status(400).json({ error: error.message });
        }

        res.status(200).json({ message: "User logged out successfully" });
    } catch (err) {
        console.error("Server Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.get("/user", async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) {
            return res.status(401).json({ error: "Unauthorized: No token provided" });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            console.error("Token Verification Failed:", error.message);
            
            // ✅ If token is expired, return 401 Unauthorized
            if (error.name === "TokenExpiredError") {
                return res.status(401).json({ error: "Token expired" });
            }

            return res.status(401).json({ error: "Invalid token" });
        }

        // ✅ Handle both Email/Password Login and Google OAuth Login
        const userId = decoded.userId || decoded.id;
        const userEmail = decoded.email;

        if (!userId && !userEmail) {
            return res.status(401).json({ error: "Invalid token format" });
        }

        // ✅ Fetch user from `users` table
        const { data: user, error } = await supabase
            .from("users")
            .select("id, email, user_name, avatar_url")
            .eq("id", userId)
            .maybeSingle();

        if (!user && userEmail) {
            // If no user found by ID, try fetching by email (Google OAuth users)
            const { data: userByEmail, error: emailError } = await supabase
                .from("users")
                .select("id, email, user_name, avatar_url")
                .eq("email", userEmail)
                .maybeSingle();

            if (!userByEmail) {
                return res.status(404).json({ error: "User not found" });
            }
            return res.json({ user: userByEmail });
        }

        if (error) {
            return res.status(500).json({ error: "Database error" });
        }

        res.json({ user });
    } catch (err) {
        console.error("Error fetching user details:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

router.put("/update-profile", async (req, res) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ error: "Unauthorized: No token provided" });

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            console.error("Token Verification Failed:", error.message);
            if (error.name === "TokenExpiredError") {
                return res.status(401).json({ error: "Token expired" });
            }
            return res.status(401).json({ error: "Invalid token" });
        }

        const userId = decoded.id || decoded.userId; // ✅ Support both token types
        if (!userId) return res.status(401).json({ error: "Invalid token format" });

        const { user_name } = req.body;
        if (!user_name) return res.status(400).json({ error: "Username is required" });

        // ✅ Update username in the `users` table
        const { data, error } = await supabase
            .from("users")
            .update({ user_name })
            .eq("id", userId);

        if (error) {
            console.error("Database Update Error:", error.message);
            return res.status(500).json({ error: "Database error" });
        }

        res.json({ message: "Username updated successfully" });
    } catch (err) {
        console.error("Error updating username:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});


// ✅ Multer Middleware for File Uploads
const upload = multer({ storage: multer.memoryStorage() });

router.post("/upload-avatar", upload.single("avatar"), async (req, res) => {
    try {
        // ✅ Extract & Verify Token
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ error: "Unauthorized: No token provided" });

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            console.error("Token Verification Failed:", error.message);
            return res.status(401).json({ error: error.name === "TokenExpiredError" ? "Token expired" : "Invalid token" });
        }

        const userId = decoded.id || decoded.userId;
        if (!userId) return res.status(401).json({ error: "Invalid token format" });

        if (!req.file) return res.status(400).json({ error: "No file uploaded" });

        // ✅ Define New Storage Path
        const fileName = `${userId}/Avatar/${req.file.originalname}`;

        // ✅ Upload file to Supabase Storage
        const { data, error } = await supabase.storage
            .from("users_storage")
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true, // ✅ Overwrites the previous avatar if exists
            });

        if (error) {
            console.error("Supabase Upload Error:", error.message);
            return res.status(500).json({ error: "Upload failed" });
        }

        // ✅ Fix: Get Public URL Correctly
        const { data: publicUrlData } = supabase.storage
            .from("users_storage")
            .getPublicUrl(fileName);

        const fileUrl = publicUrlData.publicUrl; // ✅ Get the actual URL

        if (!fileUrl) {
            console.error("Public URL generation failed");
            return res.status(500).json({ error: "Failed to retrieve public URL" });
        }

        // ✅ Update avatar URL in `users` table
        const { error: updateError } = await supabase
            .from("users")
            .update({ avatar_url: fileUrl })
            .eq("id", userId);

        if (updateError) {
            console.error("Database Update Error:", updateError.message);
            return res.status(500).json({ error: "Failed to update user avatar" });
        }

        res.json({ message: "Avatar uploaded successfully", avatar_url: fileUrl });
        // console.log(fileUrl)
    } catch (err) {
        console.error("Error uploading avatar:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});





module.exports = router;
