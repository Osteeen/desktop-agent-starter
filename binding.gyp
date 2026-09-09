{
  "targets": [
    {
      "target_name": "safe_rename",
      "sources": [
        "native/safe_rename.cc"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags!": [
        "-fno-exceptions"
      ],
      "cflags_cc!": [
        "-fno-exceptions"
      ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "NO",
        "MACOSX_DEPLOYMENT_TARGET": "12.0",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
      }
    }
  ]
}