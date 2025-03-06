require("dotenv").config();
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.routes");
const oauthRoutes = require("./routes/oauth.routes")
const fileRoutes = require("./routes/file.routes");
const userRouters = require("./routes/user.routes");

const app = express();

// **Enable CORS**
app.use(cors());

app.use(express.json());

// **Use Routes**
app.use("/api/auth", authRoutes);
app.use("/api/oauth", oauthRoutes);
app.use("/api/files", fileRoutes);
app.use("/api/user", userRouters);

// **Start Server**
const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
