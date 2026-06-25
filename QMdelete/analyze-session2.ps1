$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$path = 'C:\Users\Administrator\.claude\projects\E--QMAI\282997c5-b3c4-46ce-9c34-e84e039e78a4.jsonl'
$lines = Get-Content $path -Encoding UTF8
$i = 0
foreach ($l in $lines) {
    $i++
    try { $o = $l | ConvertFrom-Json } catch { continue }
    if ($o.type -eq 'user' -and $o.message.role -eq 'user') {
        $c = $o.message.content
        if ($c -is [array]) {
            foreach ($p in $c) {
                if ($p.type -eq 'text' -and $p.text) {
                    $t = $p.text
                    if ($t -notmatch '^\[Request interrupted' -and $t -notmatch 'tool_result' -and $t -notmatch 'task-notification' -and $t.Length -lt 1500) {
                        if ($t.Length -gt 300) { $t = $t.Substring(0, 300) + '...' }
                        Write-Output ("[" + $i + "] " + $t)
                        Write-Output "----"
                    }
                }
            }
        }
        elseif ($c -is [string]) {
            if ($c -notmatch '^\[Request interrupted' -and $c.Length -lt 1500) {
                $tt = $c
                if ($tt.Length -gt 300) { $tt = $tt.Substring(0, 300) + '...' }
                Write-Output ("[" + $i + "] " + $tt)
                Write-Output "----"
            }
        }
    }
}
