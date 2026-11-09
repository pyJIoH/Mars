"""Small PDP-11 disassembler for studying the unmodified MARS.SAV image.

Addresses and operands are octal, as in the original DEC tools.
"""
from pathlib import Path
import sys

image = Path(__file__).resolve().parents[1].joinpath('MARS.SAV').read_bytes()
pc = int(sys.argv[1], 8) if len(sys.argv) > 1 else 0o1000
end = int(sys.argv[2], 8) if len(sys.argv) > 2 else len(image)

def word():
    global pc
    value = int.from_bytes(image[pc:pc+2], 'little')
    pc += 2
    return value

def operand(spec):
    mode, reg = spec >> 3, spec & 7
    r = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'SP', 'PC'][reg]
    if mode == 0: return r
    if mode == 1: return '(' + r + ')'
    if mode == 2: return f'#{word():o}' if reg == 7 else '(' + r + ')+'
    if mode == 3: return f'@#{word():o}' if reg == 7 else '@(' + r + ')+'
    if mode == 4: return '-(' + r + ')'
    if mode == 5: return '@-(' + r + ')'
    offset = word()
    if reg == 7:
        text = f'{(pc+offset)&65535:06o}'
    else:
        text = f'{offset:o}({r})'
    return ('@' if mode == 7 else '') + text

double = {1:'MOV',2:'CMP',3:'BIT',4:'BIC',5:'BIS',6:'ADD',9:'MOVB',10:'CMPB',11:'BITB',12:'BICB',13:'BISB',14:'SUB'}
single = {0o005000:'CLR',0o005100:'COM',0o005200:'INC',0o005300:'DEC',0o005400:'NEG',0o005500:'ADC',0o005600:'SBC',0o005700:'TST',0o006000:'ROR',0o006100:'ROL',0o006200:'ASR',0o006300:'ASL',0o006700:'SXT',0o000300:'SWAB'}
branches = {0o000400:'BR',0o001000:'BNE',0o001400:'BEQ',0o002000:'BGE',0o002400:'BLT',0o003000:'BGT',0o003400:'BLE',0o100000:'BPL',0o100400:'BMI',0o101000:'BHI',0o101400:'BLOS',0o102000:'BVC',0o102400:'BVS',0o103000:'BCC',0o103400:'BCS'}
while pc < end:
    start = pc
    w = word()
    op = w & 0o177700
    if w >> 12 in double:
        text = double[w >> 12] + ' ' + operand((w >> 6)&63) + ', ' + operand(w&63)
    elif w&0o177400 in branches:
        disp = w&255
        if disp&128: disp -= 256
        text = branches[w&0o177400] + f' {(pc+disp*2)&65535:06o}'
    elif op in single or op&0o077777 in single:
        base = op&0o077777
        text = single.get(op, single.get(base,'')) + ('B' if op&0o100000 else '') + ' ' + operand(w&63)
    elif op == 0o000100: text = 'JMP ' + operand(w&63)
    elif w&0o177000 == 0o004000: text = f'JSR R{(w>>6)&7}, ' + operand(w&63)
    elif w&0o177770 == 0o000200: text = f'RTS R{w&7}'
    elif w&0o177000 == 0o077000: text = f'SOB R{(w>>6)&7}, {pc-(w&63)*2:06o}'
    elif w&0o177000 in (0o070000,0o071000,0o072000,0o073000,0o074000):
        text = {0o070000:'MUL',0o071000:'DIV',0o072000:'ASH',0o073000:'ASHC',0o074000:'XOR'}[w&0o177000] + ' ' + operand(w&63) + f', R{(w>>6)&7}'
    elif w&0o177400 == 0o104000: text = f'EMT {w&255:03o}'
    elif w&0o177740 in (0o000240,0o000260): text = f'CC {w&31:o}'
    else: text = f'.WORD {w:06o}'
    print(f'{start:06o}  {w:06o}  {text}')
