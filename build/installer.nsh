!macro customInstall
  ${If} ${Silent}
    ${StdUtils.ExecShellAsUser} $0 "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "open" ""
  ${EndIf}
!macroend
