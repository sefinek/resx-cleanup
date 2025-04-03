# RESX Cleanup 🧹
A CLI tool for removing unused entries from `.resx` resource files in **.NET applications**.
It should also work on Linux.



## ⚠️ Important
Before using this tool, make sure to **back up your RESX files**.


## 🧠 Script
### Installation
```bash
npm install resx-cleanup
```

### Example
```js
const { resxCleanup, version } = require('resx-cleanup');

resxCleanup(['C:\\Users\\KeyboardCat\\source\\repos\\WinFormsApp1', 'C:\\Users\\KeyboardCat\\source\\repos\\WinFormsApp2']);
console.log('Version:', version);
```

## 💻 CLI
### Global Installation
```bash
npm install resx-cleanup -g
```

### Example usage
```bash
resx-cleanup --project C:\Users\Sefinek\source\repos\WinFormsApp1
```

### Version
```bash
resx-cleanup --version
```


## 🔖 MIT License
Copyright 2025 © by [Sefinek](https://sefinek.net). All Rights Reserved.