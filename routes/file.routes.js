const express = require("express");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const supabase = require("../config/supabaseClient");
require("dotenv").config();

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const folderMapping = {
  images: ["jpg", "jpeg", "png", "gif", "svg", "webp"],
  audio: ["mp3", "wav", "ogg", "flac"],
  documents: ["pdf", "docx", "txt", "xlsx"],
};

const getFolderName = (fileName) => {
  const ext = fileName.split(".").pop().toLowerCase();
  if (folderMapping.images.includes(ext)) return "Images";
  if (folderMapping.audio.includes(ext)) return "Audio";
  if (folderMapping.documents.includes(ext)) return "Documents";
  return "Other";
};

router.post("/upload-multiple", upload.array("files", 10), async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ error: "Unauthorized: No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("Token Verification Failed:", error.message);
      return res
        .status(401)
        .json({
          error:
            error.name === "TokenExpiredError"
              ? "Token expired"
              : "Invalid token",
        });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) return res.status(401).json({ error: "Invalid token format" });

    if (!req.files || req.files.length === 0)
      return res.status(400).json({ error: "No files uploaded" });

    let uploadedFiles = [];

    for (const file of req.files) {
      const folderName = getFolderName(file.originalname);
      const fileSize = file.size;
      const fileType = file.mimetype;
      const fileName = `${userId}/${folderName}/${Date.now()}-${
        file.originalname
      }`;

      const { data, error } = await supabase.storage
        .from("users_storage")
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false,
        });

      if (error) {
        console.error(`Error uploading ${file.originalname}:`, error.message);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from("users_storage")
        .getPublicUrl(fileName);
      const fileUrl = urlData.publicUrl;

      if (!fileUrl) {
        console.error(`Public URL generation failed for ${file.originalname}`);
        continue;
      }

      const { error: dbError } = await supabase.from("files").insert([
        {
          user_id: userId,
          file_name: file.originalname,
          folder: folderName,
          file_url: fileUrl,
          size: fileSize,
          type: fileType,
          uploaded_at: new Date(),
        },
      ]);

      if (dbError) {
        console.error(
          `Database Insert Error for ${file.originalname}:`,
          dbError.message
        );
        continue;
      }

      uploadedFiles.push({
        file_name: file.originalname,
        file_url: fileUrl,
        folder: folderName,
      });
    }

    res.json({ message: "Files uploaded successfully", files: uploadedFiles });
  } catch (err) {
    console.error("Error uploading files:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/recent-files", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ error: "Unauthorized: No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("Token Verification Failed:", error.message);
      return res
        .status(401)
        .json({
          error:
            error.name === "TokenExpiredError"
              ? "Token expired"
              : "Invalid token",
        });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) return res.status(401).json({ error: "Invalid token format" });

    const limit = parseInt(req.query.limit) || 10;

    const { data, error } = await supabase
      .from("files")
      .select("file_name, folder, file_url, size, type, uploaded_at")
      .eq("user_id", userId)
      .eq("is_deleted", false)
      .order("uploaded_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Database Fetch Error:", error.message);
      return res.status(500).json({ error: "Failed to fetch recent files" });
    }

    res.json({ message: "Recent files retrieved successfully", files: data });
  } catch (err) {
    console.error("Error fetching recent files:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/delete-multiple", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ error: "Unauthorized: No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("Token Verification Failed:", error.message);
      return res
        .status(401)
        .json({
          error:
            error.name === "TokenExpiredError"
              ? "Token expired"
              : "Invalid token",
        });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) return res.status(401).json({ error: "Invalid token format" });

    const { files } = req.body;
    if (!files || files.length === 0)
      return res.status(400).json({ error: "No files provided for deletion" });

    let movedFiles = [];
    let failedFiles = [];

    for (const fileUrl of files) {
      try {
        const filePath = fileUrl.split(
          "/storage/v1/object/public/users_storage/"
        )[1];

        if (!filePath) {
          failedFiles.push({ fileUrl, error: "Invalid file path" });
          continue;
        }

        const fileName = filePath.split("/").pop();
        const trashPath = `${userId}/Trash/${Date.now()}-${fileName}`;

        const { data, error } = await supabase.storage
          .from("users_storage")
          .move(filePath, trashPath);

        if (error) {
          console.error(`Failed to move file ${fileUrl}:`, error.message);
          failedFiles.push({ fileUrl, error: error.message });
          continue;
        }

        const { data: urlData } = supabase.storage
          .from("users_storage")
          .getPublicUrl(trashPath);
        const newFileUrl = urlData.publicUrl;

        const { error: dbError } = await supabase
          .from("files")
          .update({ file_url: newFileUrl, folder: "Trash", is_deleted: true })
          .eq("file_url", fileUrl);

        if (dbError) {
          console.error(
            `Database Update Error for ${fileUrl}:`,
            dbError.message
          );
          failedFiles.push({ fileUrl, error: dbError.message });
          continue;
        }

        movedFiles.push({
          old_url: fileUrl,
          new_url: newFileUrl,
          folder: "Trash",
        });
      } catch (err) {
        console.error(`Unexpected Error for ${fileUrl}:`, err.message);
        failedFiles.push({ fileUrl, error: err.message });
      }
    }

    res.json({
      message: "Files processed successfully",
      movedFiles,
      failedFiles,
    });
  } catch (err) {
    console.error("Error deleting files:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/trash-files", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ error: "Unauthorized: No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("Token Verification Failed:", error.message);
      return res
        .status(401)
        .json({
          error:
            error.name === "TokenExpiredError"
              ? "Token expired"
              : "Invalid token",
        });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) return res.status(401).json({ error: "Invalid token format" });

    const limit = parseInt(req.query.limit) || 10;

    const { data, error } = await supabase
      .from("files")
      .select("file_name, folder, file_url, size, type, uploaded_at")
      .eq("user_id", userId)
      .eq("is_deleted", true)
      .order("uploaded_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Database Fetch Error:", error.message);
      return res.status(500).json({ error: "Failed to fetch deleted files" });
    }

    res.json({ message: "Trash files retrieved successfully", files: data });
  } catch (err) {
    console.error("Error fetching deleted files:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/file-details", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ error: "Unauthorized: No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("Token Verification Failed:", error.message);
      return res.status(401).json({ error: "Invalid token" });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) return res.status(401).json({ error: "Invalid token format" });

    const fileUrl = req.query.file_url;
    if (!fileUrl)
      return res.status(400).json({ error: "File URL is required" });

    const { data, error } = await supabase
      .from("files")
      .select("file_name, file_url, size, type, uploaded_at, modified_at")
      .eq("user_id", userId)
      .eq("file_url", fileUrl)
      .single();

    if (error || !data) {
      console.error("File Not Found:", error?.message);
      return res.status(404).json({ error: "File not found" });
    }

    res.json({ message: "File details retrieved successfully", file: data });
  } catch (err) {
    console.error("Error fetching file details:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.post("/create-folder", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ error: "Unauthorized: No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("Token Verification Failed:", error.message);
      return res.status(401).json({ error: "Invalid token" });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) return res.status(401).json({ error: "Invalid token format" });

    const { folderName, color } = req.body;
    if (!folderName || folderName.trim() === "") {
      return res.status(400).json({ error: "Folder name is required" });
    }

    const validColors = ["blue", "green", "purple", "orange", "pink"];
    if (!validColors.includes(color)) {
      return res.status(400).json({ error: "Invalid folder color" });
    }

    const folderPath = `${userId}/Folders/${folderName}/`;

    const { data, error } = await supabase.storage
      .from("users_storage")
      .upload(`${folderPath}placeholder.txt`, Buffer.from(""), {
        contentType: "text/plain",
      });

    if (error) {
      console.error("Folder Creation Error:", error.message);
      return res.status(500).json({ error: "Failed to create folder" });
    }

    const { error: dbError } = await supabase
      .from("folders")
      .insert([
        {
          user_id: userId,
          folder_name: folderName,
          folder_path: folderPath,
          color,
        },
      ]);

    if (dbError) {
      console.error("Database Insert Error:", dbError.message);
      return res.status(500).json({ error: "Failed to save folder metadata" });
    }

    res.json({ message: "Folder created successfully", folderPath, color });
  } catch (err) {
    console.error("Error creating folder:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/user-folders", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ error: "Unauthorized: No token provided" });

    let decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id || decoded.userId;

    const { data, error } = await supabase
      .from("folders")
      .select("folder_name, folder_path, color, created_at")
      .eq("user_id", userId);

    if (error) {
      console.error("Database Fetch Error:", error.message);
      return res.status(500).json({ error: "Failed to fetch folders" });
    }

    res.json({ message: "Folders retrieved successfully", folders: data });
  } catch (err) {
    console.error("Error fetching folders:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.delete("/delete-folder", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ error: "Unauthorized: No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("Token Verification Failed:", error.message);
      return res.status(401).json({ error: "Invalid token" });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) return res.status(401).json({ error: "Invalid token format" });

    const { folderPath } = req.body;
    if (!folderPath)
      return res.status(400).json({ error: "Folder path is required" });

    const { data: files, error: listError } = await supabase.storage
      .from("users_storage")
      .list(folderPath);

    if (listError) {
      console.error("Error listing folder contents:", listError.message);
      return res.status(500).json({ error: "Failed to list folder contents" });
    }

    for (const file of files) {
      const filePath = `${folderPath}${file.name}`;

      const { error: deleteFileError } = await supabase.storage
        .from("users_storage")
        .remove([filePath]);

      if (deleteFileError) {
        console.error("Error deleting file:", deleteFileError.message);
        return res.status(500).json({ error: "Failed to delete folder files" });
      }
    }

    const { error: dbError } = await supabase
      .from("folders")
      .delete()
      .eq("user_id", userId)
      .eq("folder_path", folderPath);

    if (dbError) {
      console.error("Database Delete Error:", dbError.message);
      return res
        .status(500)
        .json({ error: "Failed to delete folder from database" });
    }

    res.json({ message: "Folder and its files deleted successfully" });
  } catch (err) {
    console.error("Error deleting folder:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.put("/move-file", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token)
      return res.status(401).json({ error: "Unauthorized: No token provided" });

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("Token Verification Failed:", error.message);
      return res.status(401).json({ error: "Invalid token" });
    }

    const userId = decoded.id || decoded.userId;
    if (!userId) return res.status(401).json({ error: "Invalid token format" });

    const { fileName, currentPath, newFolderName } = req.body;
    if (!fileName || !currentPath || !newFolderName) {
      return res
        .status(400)
        .json({
          error: "File name, current path, and new folder name are required",
        });
    }

    const newPath = `${userId}/Folders/${newFolderName}/${fileName}`;

    const { error: copyError } = await supabase.storage
      .from("users_storage")
      .copy(currentPath, newPath);

    if (copyError) {
      console.error("File Copy Error:", copyError.message);
      return res
        .status(500)
        .json({ error: "Failed to copy file to new location" });
    }

    const { error: deleteError } = await supabase.storage
      .from("users_storage")
      .remove([currentPath]);

    if (deleteError) {
      console.error("File Delete Error:", deleteError.message);
      return res
        .status(500)
        .json({ error: "Failed to delete old file after moving" });
    }

    const { error: dbError } = await supabase
      .from("files")
      .update({ file_url: newPath, folder_name: newFolderName })
      .eq("user_id", userId)
      .eq("file_name", fileName);

    if (dbError) {
      console.error("Database Update Error:", dbError.message);
      return res.status(500).json({ error: "Failed to update file metadata" });
    }

    res.json({ message: "File moved successfully", newPath });
  } catch (err) {
    console.error("Error moving file:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
