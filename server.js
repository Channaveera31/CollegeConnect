const express = require("express");
const multer = require("multer");
const ImageKit = require("imagekit");
const cors = require("cors");

const app = express();
const path = require("path");
const upload = multer();

app.use(cors());

// Serve all static files from project root
app.use(express.static(path.join(__dirname)));

// Optional: default route → index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const imagekit = new ImageKit({
  publicKey: "public_aTE5JJek9Za9N0XM4KIgzX2EKAc=",
  privateKey: "private_6RBztjGJtGEe9krpItIvVxO8AdA=",
  urlEndpoint: "https://ik.imagekit.io/2v7bpla6v",
});

app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const fileName = req.body.fileName || req.file.originalname;

    const result = await imagekit.upload({
      file: fileBuffer,
      fileName: fileName,
      folder: "/Files",
    });

    res.json({ url: result.url, fileId: result.fileId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

app.get("/", (req, res) => {
  res.send("Server is working! 🚀");
});
