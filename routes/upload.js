const express = require("express");
const multer = require("multer");
const ImageKit = require("imagekit");

const router = express.Router();
const upload = multer();

const imagekit = new ImageKit({
  publicKey: "public_aTE5JJek9Za9N0XM4KIgzX2EKAc=",
  privateKey: "6RBztjGJtGEe9krpItIvVxO8AdA=",
  urlEndpoint: "https://ik.imagekit.io/2v7bpla6v",
});

router.post("/", upload.single("file"), async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const fileName = req.body.fileName || req.file.originalname;

    const result = await imagekit.upload({
      file: fileBuffer,
      fileName: fileName,
      folder: "/Files", // or your folder
    });

    res.json({ url: result.url, fileId: result.fileId });
  } catch (error) {
    res.status(500).json({
      message: error.message,
      help: "For support kindly contact us at support@imagekit.io .",
    });
  }
});

module.exports = router;
