import numpy as np, colorsys
from PIL import Image, ImageDraw, ImageFont
rng=np.random.default_rng(3)
W,H=200,130
def hsl(h,s,l):
    r,g,b=colorsys.hls_to_rgb((h%360)/360,l,s); return np.array([r,g,b])
BONE=(36,.22,.9)
def P(name,bg,p,s,a,hl,duo=False,paper=BONE):
    return dict(name=name,bg=hsl(*bg),primary=hsl(*p),secondary=hsl(*s),accent=hsl(*a),highlight=hsl(*hl),paper=hsl(*paper),duo=duo)
def duo(name,hue,sat,light=.56):
    return P(name,(hue,sat*.35,.025),(hue,sat,light),(hue+6,sat*.95,light*.62),(hue-8,sat*.9,min(.82,light+.18)),(hue-4,sat*.55,.88),True,(hue,min(.2,sat*.18),.9))
CUR=[P('Ocean',(240,.3,.04),(220,.7,.55),(260,.5,.45),(180,.6,.5),(200,.8,.7)),
P('Aurora',(270,.2,.04),(150,.6,.5),(280,.5,.5),(60,.7,.55),(180,.7,.65)),
P('Ember',(10,.3,.04),(15,.8,.5),(35,.7,.45),(350,.6,.45),(45,.9,.6)),
P('Neon',(260,.25,.03),(300,.8,.55),(180,.9,.5),(60,.95,.55),(330,.85,.65)),
P('Crimson',(350,.3,.04),(350,.8,.5),(15,.65,.5),(320,.7,.55),(5,.85,.65)),
P('Gold',(30,.3,.04),(42,.85,.55),(25,.75,.48),(55,.9,.6),(50,.95,.72)),
P('Violet',(270,.25,.04),(270,.7,.55),(300,.5,.45),(240,.6,.55),(280,.75,.7)),
duo('Ember/Black',24,.92,.55),duo('Ivory/Black',38,.28,.82),duo('Cold/Black',214,.78,.56),duo('Crimson/Black',352,.82,.48)]
NEW=[CUR[0],
P('Aurora v2',(230,.3,.035),(165,.75,.5),(195,.7,.45),(275,.6,.6),(130,.7,.7)),
CUR[2],CUR[3],CUR[4],
P('Solar',(25,.35,.035),(40,.95,.55),(18,.85,.45),(350,.75,.5),(52,1,.75)),
CUR[6],
P('Sunset',(280,.35,.035),(325,.85,.55),(275,.65,.45),(25,.95,.55),(45,1,.7)),
P('Acid',(160,.3,.03),(85,.9,.5),(150,.8,.42),(300,.8,.6),(70,1,.75))]
def tm(c): return c/(1+c)*1.25
yy,xx=np.mgrid[0:H,0:W]/H
def noise(seed,scale):
    r=np.random.default_rng(seed); g=r.random((8,10)); 
    im=Image.fromarray((g*255).astype(np.uint8)).resize((W,H),Image.BICUBIC); return np.asarray(im)/255
N1,N2,N3=noise(1,0),noise(2,0),noise(5,0)
def silk(p):
    img=np.tile(p['bg']*.6,(H,W,1)); acc=np.zeros((H,W,3))
    r=np.random.default_rng(7)
    for i in range(60):
        k=r.random(); col=p['primary'] if k<.62 else p['secondary'] if k<.86 else p['highlight'] if k<.95 else p['accent']
        ph=r.random()*6; a=r.random()*.25+.1; f=r.random()*3+2; off=r.random()*1.2
        yc=off+a*np.sin(xx*f+ph)
        acc+=np.exp(-((yy-yc)**2)/0.0004)[...,None]*col*0.35
    return np.clip(tm(img+acc*1.1),0,1)
def ink(p):
    A=np.clip((N1-.45)*3,0,1); B=np.clip((N2-.55)*3,0,1); sp=(np.clip((N3-.8)*6,0,1))**2
    inkB=p['secondary'] if p['duo'] else p['accent']
    c=p['bg']*0.6+A[...,None]*p['primary']*1.1+B[...,None]*inkB*1.1+sp[...,None]*p['highlight']*1.6
    return np.clip(tm(c),0,1)
def voyage(p):
    band=N2; tint=p['primary']*(1-band[...,None])+p['secondary']*band[...,None]
    stone=np.array([.66,.64,.61]); alb=stone*(1-.42)+tint*.42
    dif=np.clip(1-((xx-.9)**2+(yy-.4)**2)*1.2,0,1)[...,None]
    light=dif*1.5*(np.ones(3)*.7+p['highlight']*.3)+0.25
    col=alb*light*np.clip(N1+.3,0,1)[...,None]
    vein=np.exp(-((N3-.6)**2)/0.0008)[...,None]
    col+=p['accent']*vein*0.6
    sky=p['bg']*3+p['primary']*0.05
    mask=(N1>0.32)[...,None]
    return np.clip(tm(np.where(mask,col,sky)),0,1)
def sumi(p):
    A=np.clip((N1-.5)*4,0,1)[...,None]; ink=p['primary']*.55
    return np.clip(p['paper']*(1-A)+ink*A,0,1)
TILES=[('Silk / Wisp / Warp',silk),('Ink Glow',ink),('Voyage fractal',voyage),('Sumi (paper)',sumi)]
def board(pals,title,out):
    pad=8; lw=120; th=22
    B=Image.new('RGB',(lw+len(TILES)*(W+pad)+pad, th+28+len(pals)*(H+pad)+pad),(14,14,17))
    d=ImageDraw.Draw(B)
    try: f=ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Medium.otf',13); fb=ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-SemiBold.otf',15)
    except: f=fb=None
    d.text((pad,6),title,fill=(236,231,223),font=fb)
    for j,(tn,_) in enumerate(TILES): d.text((lw+pad+j*(W+pad),th+6),tn,fill=(180,175,168),font=f)
    for i,p in enumerate(pals):
        y=th+28+i*(H+pad)
        d.text((pad,y+H//2-16),p['name'],fill=(236,231,223),font=f)
        for k,c in enumerate(['primary','secondary','accent','highlight']):
            col=tuple((p[c]*255).astype(int)); d.rectangle([pad+k*22,y+H//2+4,pad+k*22+18,y+H//2+22],fill=col)
        for j,(_,fn) in enumerate(TILES):
            B.paste(Image.fromarray((fn(p)*255).astype(np.uint8)),(lw+pad+j*(W+pad),y))
    B.save(out)
board(CUR,'Current palettes, simulated with each style\'s colour formula','current.png')
board(NEW,'Proposed set: keep Ocean, Ember, Neon, Crimson, Violet; rework Aurora and Gold; add Sunset and Acid; drop duotones','proposed.png')
