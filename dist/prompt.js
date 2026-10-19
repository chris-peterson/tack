// CLI-61: the zsh prompt integration `tack prompt zsh` prints and
// `tack install-cli --prompt` installs. It runs `tack` only on entering a
// different repo, since a call costs Node's startup and a prompt redraws on
// every command.
export const ZSH_PROMPT = `# tack prompt integration, from \`tack prompt zsh\`.
#
# Sets TACK_PROMPT_DIR to where you are: the repo's shortest unique label
# (\`tack repo label\`) followed by the path inside it, such as
# acme/ai-tools/src/lib. Outside a checkout, and inside .git/, it is the
# working directory as %~ shows it. Put \${TACK_PROMPT_DIR} in PROMPT.

autoload -Uz add-zsh-hook
setopt prompt_subst

typeset -g TACK_PROMPT_DIR='' _tack_prompt_top='' _tack_prompt_label=''

_tack_prompt_chpwd() {
  # A cd inside $(...) fires chpwd too, and nothing reads the prompt there.
  (( ZSH_SUBSHELL )) && return
  local top here=\${PWD:A} dir
  if top=$(git rev-parse --show-toplevel 2>/dev/null) && [[ $here == $top || $here == $top/* ]]; then
    if [[ $top != $_tack_prompt_top ]]; then
      _tack_prompt_top=$top
      _tack_prompt_label=$(tack repo label "$top" 2>/dev/null) || _tack_prompt_label=\${top:t}
    fi
    dir=$_tack_prompt_label\${here#$top}
  else
    _tack_prompt_top=''
    dir=\${(%):-%~}
  fi
  # PROMPT expands % escapes after substitution, and a folder name can hold a %.
  TACK_PROMPT_DIR=\${dir//\\%/%%}
}

add-zsh-hook chpwd _tack_prompt_chpwd
_tack_prompt_chpwd
`;
