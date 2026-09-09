#import <Cocoa/Cocoa.h>
#import <Carbon/Carbon.h>
@interface AuditTextView : NSTextView
@end
@implementation AuditTextView
- (void)paste:(id)sender {}
- (void)copy:(id)sender {}
- (void)cut:(id)sender {}
@end
int main(){@autoreleasepool{[NSApplication sharedApplication];const void *keys[]={kTISPropertyInputSourceID};const void *vals[]={CFSTR("com.apple.keylayout.US")};CFDictionaryRef d=CFDictionaryCreate(NULL,keys,vals,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);CFArrayRef a=TISCreateInputSourceList(d,true);TISInputSourceRef src=(TISInputSourceRef)CFArrayGetValueAtIndex(a,0);CFDataRef data=TISGetInputSourceProperty(src,kTISPropertyUnicodeKeyLayoutData);const UCKeyboardLayout *layout=(const UCKeyboardLayout *)CFDataGetBytePtr(data);NSTextView *view=[[AuditTextView alloc]initWithFrame:NSMakeRect(0,0,400,100)];NSWindow *w=[[NSWindow alloc]initWithContentRect:NSMakeRect(0,0,400,100) styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];[w setContentView:view];[w makeFirstResponder:view];
int codes[]={6,12,13,1,8,7,9,45,31,51,117,3,5,126};int failures=0;for(int j=0;j<14;j++)for(int mask=8;mask<16;mask++){int key=codes[j];UInt32 mods=0;NSEventModifierFlags f=0;if(mask&1){mods|=shiftKey;f|=NSEventModifierFlagShift;}if(mask&2){mods|=optionKey;f|=NSEventModifierFlagOption;}if(mask&4){mods|=controlKey;f|=NSEventModifierFlagControl;}if(mask&8){mods|=cmdKey;f|=NSEventModifierFlagCommand;}UInt32 dead=0;UniChar ch[16];UniCharCount n=0;UCKeyTranslate(layout,key,kUCKeyActionDown,(mods>>8)&255,LMGetKbdType(),kUCKeyTranslateNoDeadKeysBit,&dead,16,&n,ch);NSString *s=[NSString stringWithCharacters:ch length:n];view.string=@"";NSEvent *e=[NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:f timestamp:0 windowNumber:w.windowNumber context:nil characters:s charactersIgnoringModifiers:s isARepeat:NO keyCode:key];[view keyDown:e];if(view.string.length)failures++;}
printf("112 Command combinations: %d text insertions\n",failures);[w close];return failures ? 1 : 0;}}
