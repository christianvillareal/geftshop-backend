require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });
const PRODUCTS_FILE = path.join(__dirname, 'data', 'products.json');

const readProducts = () => {
  if (!fs.existsSync(PRODUCTS_FILE)) return [];
  return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
};
const writeProducts = (data) => {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
};

app.get('/api/products', (req, res) => {
  const products = readProducts();
  res.json(products);
});

app.get('/api/products/:id', (req, res) => {
  const products = readProducts();
  const product = products.find(p => p.id == req.params.id);
  product ? res.json(product) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    let imageUrl = null;
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path);
      imageUrl = result.secure_url;
      fs.unlinkSync(req.file.path);
    }
    const products = readProducts();
    const newProduct = {
      id: Date.now(),
      name: req.body.name,
      description: req.body.description,
      price: parseFloat(req.body.price),
      color: req.body.color,
      size: req.body.size,
      stock: parseInt(req.body.stock) || 0,
      dressCode: req.body.dressCode || '',
      productWeight: parseFloat(req.body.productWeight) || 0,
      shippingFee: parseFloat(req.body.shippingFee) || 0,
      weightKg: parseFloat(req.body.weightKg) || 0,
      bust: parseFloat(req.body.bust) || 0,
      length: parseFloat(req.body.length) || 0,
      waist: parseFloat(req.body.waist) || 0,
      asianSize: req.body.asianSize || '',
      imageUrl: imageUrl,
    };
    products.push(newProduct);
    writeProducts(products);
    res.status(201).json(newProduct);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    let products = readProducts();
    const index = products.findIndex(p => p.id == req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    let imageUrl = products[index].imageUrl;
    if (req.file) {
      const result = await cloudinary.uploader.upload(req.file.path);
      imageUrl = result.secure_url;
      fs.unlinkSync(req.file.path);
    }
    const updated = {
      ...products[index],
      ...req.body,
      imageUrl,
      price: parseFloat(req.body.price) || products[index].price,
      stock: parseInt(req.body.stock) !== undefined ? parseInt(req.body.stock) : products[index].stock,
    };
    products[index] = updated;
    writeProducts(products);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/products/:id', (req, res) => {
  let products = readProducts();
  const newProducts = products.filter(p => p.id != req.params.id);
  if (newProducts.length === products.length) return res.status(404).json({ error: 'Not found' });
  writeProducts(newProducts);
  res.json({ message: 'Deleted' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));